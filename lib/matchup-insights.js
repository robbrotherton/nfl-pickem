const { createStore } = require('./insights-store');
const { createEspnCache } = require('./espn-cache');
const { createAvailability, upcoming } = require('./team-availability');
const { athleteId } = require('./athlete-identity');
const { rankInjuries, quarterbackHistory } = require('./player-context');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

function priorGames(games, game) {
    return games.filter(row => row.id !== game.id && Number(row.season_type) === 2 && row.status === 'final' &&
        Date.parse(row.game_date) < Date.parse(game.game_date) && Number.isFinite(row.away_score) && Number.isFinite(row.home_score));
}
function teamResult(game, team) {
    const home = game.home_team === team;
    const score = home ? game.home_score : game.away_score;
    const opponentScore = home ? game.away_score : game.home_score;
    return { id: game.id, date: game.game_date, season: game.season, week: game.week,
        opponent: home ? game.away_team : game.home_team, home, score, opponentScore,
        result: score === opponentScore ? 'T' : score > opponentScore ? 'W' : 'L',
        source: `https://www.espn.com/nfl/game/_/gameId/${game.id}` };
}
function commonOpponents(games, game) {
    const history = priorGames(games.filter(g => Number(g.season) === Number(game.season)), game);
    const results = team => history.filter(g => g.away_team === team || g.home_team === team)
        .sort((a,b) => Date.parse(b.game_date)-Date.parse(a.game_date)).map(g => teamResult(g,team));
    const away = results(game.away_team), home = results(game.home_team);
    return away.filter(a => home.some(h => h.opponent === a.opponent))
        .filter((a,index,rows) => rows.findIndex(r => r.opponent === a.opponent) === index)
        .map(a => ({opponent:a.opponent,away:a,home:home.find(h=>h.opponent===a.opponent)}))
        .sort((a,b) => Number(b.away.result !== b.home.result)-Number(a.away.result !== a.home.result) || Date.parse(b.away.date)-Date.parse(a.away.date)).slice(0,4);
}
function normalizeSchedule(data, year) {
    // ESPN's season header describes today; requestedSeason describes this schedule.
    const context = data.requestedSeason || data.season;
    if (Number(context?.year) !== Number(year) || Number(context?.type) !== 2) throw new Error('Schedule context mismatch');
    for (const event of data.events || []) {
        if ((event.season?.year !== undefined && Number(event.season.year) !== Number(year)) ||
            (event.season?.type !== undefined && Number(event.season.type) !== 2)) throw new Error('Event context mismatch');
    }
    return (data.events || []).flatMap(event => {
        const competition = event.competitions?.[0];
        const home = competition?.competitors?.find(t => t.homeAway === 'home');
        const away = competition?.competitors?.find(t => t.homeAway === 'away');
        if (!home || !away || !competition.status?.type?.completed) return [];
        const score = team => Number(team.score?.value ?? team.score?.displayValue ?? team.score);
        return [{id:String(event.id),season:Number(year),season_type:2,week:event.week?.number,game_date:event.date,
            home_team:home.team.displayName,away_team:away.team.displayName,home_score:score(home),away_score:score(away),status:'final',
            home_logo:home.team.logo || home.team.logos?.[0]?.href,away_logo:away.team.logo || away.team.logos?.[0]?.href,
            home_abbr:home.team.abbreviation,away_abbr:away.team.abbreviation}];
    });
}
function createInsights({db,cacheDir,now=()=>Date.now(),fetchJson=async url=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error(`ESPN HTTP ${response.status}`);
    return response.json();
}}) {
    const store = createStore(cacheDir, now);
    const cache = createEspnCache({ store, now, fetchJson });
    const teamAvailability = createAvailability({ db, store, cache, now });
    function ingestScoreboard(data) {
        store.ingestScoreboard(data);
        // Archiving must never delay or break the scoreboard response.
        return teamAvailability.captureScoreboard(data).catch(error => {
            console.warn('Pregame availability capture failed:', error.message);
        });
    }
    async function get(gameId) {
        const game=db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
        if(!game) return null;
        const warnings=[];
        const safe=async(url,ttl,options={})=>{
            try {
                const result = await cache.get(url, ttl, options);
                if (result.stale) warnings.push('Some ESPN data could not be refreshed; saved data is shown with its earlier update time.');
                return result.data;
            }
            catch{warnings.push('Some ESPN data is unavailable.');return null;}
        };
        const all=db.prepare('SELECT * FROM games WHERE season BETWEEN ? AND ? AND season_type = 2').all(game.season-5,game.season);
        const names=[game.away_team,game.home_team];
        let registry=names.map((name,index)=>store.resolve(name,game[index===0?'away_abbr':'home_abbr']));
        if(registry.some(team=>!team)) {
            const directory=await safe(`${BASE}/teams?limit=100`,30*24*60*60*1000,{validate:data=>{
                if(!data.sports?.some(sport=>sport.leagues?.some(league=>league.teams?.length))) throw new Error('Team directory unavailable');
            }});
            for(const sport of directory?.sports || []) for(const league of sport.leagues || []) for(const row of league.teams || []) store.team(row.team);
            registry=names.map((name,index)=>store.resolve(name,game[index===0?'away_abbr':'home_abbr']));
        }
        const ids=registry.map(team=>team?.id);
        const history=[...all];
        const today=new Date(now());
        const activeSeason=today.getUTCFullYear()-(today.getUTCMonth()<2 ? 1 : 0);
        if(ids[0]) {
            const years=[0,1,2,3,4,5].map(offset=>game.season-offset).filter(year=>{
                const expected=year>=2021?17:16;
                const local=all.filter(row=>row.season===year && (row.away_team===game.away_team || row.home_team===game.away_team));
                return local.length<expected || local.some(row=>Date.parse(row.game_date)<now() &&
                    (row.status!=='final' || row.away_score==null || row.home_score==null));
            });
            const schedules=await Promise.all(years.map(year=>safe(`${BASE}/teams/${ids[0]}/schedule?season=${year}&seasontype=2`,
                year<activeSeason ? Infinity : 6*60*60*1000,{validate:data=>normalizeSchedule(data,year)})));
            schedules.forEach((data,index)=>{if(data){try{history.push(...normalizeSchedule(data,years[index]));}catch{warnings.push('Historical schedule context could not be verified.');}}});
        } else warnings.push('Historical ESPN schedules are unavailable; showing stored results.');
        const distinct=Array.from(new Map(history.map(row=>[row.id,row])).values());
        // Reuse logos already present in schedules, stored games, and the team registry.
        const teams={};
        for(const row of [...distinct,game]) {
            for(const side of ['away','home']) {
                const name=row[side+'_team'];
                if(!name) continue;
                const existing=teams[name] || {};
                teams[name]={name,abbr:row[side+'_abbr'] || existing.abbr || name,
                    logo:row[side+'_logo'] || existing.logo || ''};
            }
        }
        registry.forEach((team,index)=>{if(team) teams[names[index]]={name:names[index],abbr:team.abbr,logo:team.logo};});
        const previous=priorGames(distinct,game);
        const meetings=previous.filter(g=>(g.away_team===game.away_team && g.home_team===game.home_team)||(g.home_team===game.away_team && g.away_team===game.home_team))
            .sort((a,b)=>Date.parse(b.game_date)-Date.parse(a.game_date)).slice(0,5).map(g=>({ ...teamResult(g,game.away_team),awayTeam:g.away_team,homeTeam:g.home_team,awayScore:g.away_score,homeScore:g.home_score }));
        const current = upcoming(game, now());
        const availability = {
            historical: !current,
            note: current ? 'Depth-chart roles, regular-season stats, and reported injuries. Expected replacements are not confirmed game-day starters.' :
                'Saved pregame reports describe what was known before kickoff, not confirmed game participation. Games without a captured report remain unknown.',
            teams: []
        };
        if (current) {
            availability.teams = await Promise.all(names.map((name, index) => teamAvailability.get(game, name, ids[index])));
        } else if (Date.parse(game.game_date) <= now()) {
            availability.teams = names.map((name, index) => {
                const saved = store.availability(game, ids[index]);
                return saved ? { ...saved, historical: true } : { name, historical: true, missing: true };
            });
        } else {
            availability.note = 'Player availability is shown for upcoming matchups within eight days of kickoff.';
        }
        for (const context of availability.teams) warnings.push(...(context.warnings || []));
        function withQuarterbackHistory(result, name) {
            const row = all.find(game => game.id === result.id);
            const team = store.resolve(name);
            return { ...result, quarterback: row && team ? quarterbackHistory(store.availability(row, team.id)) : null };
        }
        const comparisons = commonOpponents(all, game).map(comparison => ({ ...comparison,
            away: withQuarterbackHistory(comparison.away, game.away_team),
            home: withQuarterbackHistory(comparison.home, game.home_team) }));
        const recent=[game.away_team,game.home_team].map(name=>({name,games:priorGames(all.filter(g=>g.season===game.season),game)
            .filter(g=>g.away_team===name || g.home_team===name).sort((a,b)=>Date.parse(b.game_date)-Date.parse(a.game_date)).slice(0,3).map(g=>withQuarterbackHistory(teamResult(g,name),name))}));
        return {gameId:game.id,season:game.season,seasonType:game.season_type,kickoff:game.game_date,generatedAt:new Date(now()).toISOString(),
            teams,availability,meetings,historyNote:'Regular-season meetings in the selected season and previous five seasons, before this matchup.',
            commonOpponents:comparisons,recent,warnings:[...new Set(warnings)],
            source:`https://www.espn.com/nfl/game/_/gameId/${game.id}`};
    }
    return {get,ingestScoreboard,close:store.close};
}
module.exports={createInsights,athleteId,priorGames,teamResult,commonOpponents,normalizeSchedule,rankInjuries};
