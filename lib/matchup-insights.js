const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

function athleteId(athlete = {}) {
    return String(athlete.id || athlete.links?.map(link => link.href?.match(/\/id\/(\d+)/)?.[1]).find(Boolean) || '');
}

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
function recentRoles(summary, teamId) {
    const roles = new Map();
    const playerGroup = summary?.boxscore?.players?.find(row => String(row.team?.id) === String(teamId));
    for (const group of playerGroup?.statistics || []) {
        const labels = {passing:'Recent leading passer',rushing:'Recent leading rusher',receiving:'Recent leading receiver'};
        if (labels[group.name] && group.athletes?.[0]) roles.set(athleteId(group.athletes[0].athlete),labels[group.name]);
    }
    return roles;
}
function rankInjuries(rows, depth, roles = new Map()) {
    const starters = new Map();
    for (const formation of depth?.depthchart || []) {
        for (const position of Object.values(formation.positions || {})) {
            const first = position.athletes?.[0];
            if (first) starters.set(athleteId(first),position.position?.abbreviation || '');
        }
    }
    const severity = {out:4,'injured reserve':4,doubtful:3,questionable:2,'day-to-day':1};
    return rows.filter(row => !['active', 'healthy'].includes(String(row.status || '').toLowerCase())).map(row => {
        const id=athleteId(row.athlete),position=row.athlete?.position?.abbreviation || starters.get(id) || '';
        const role=starters.has(id) ? 'Listed starter' : roles.get(id) || 'Role unconfirmed';
        const status=row.status || row.type?.description || 'Status unavailable';
        const importance=role==='Listed starter' ? 50 : roles.has(id) ? 40 : 0;
        const qb=position==='QB' && importance>0 ? 100 : 0;
        const reason=row.details?.type || '';
        return {id,name:row.athlete?.displayName || row.athlete?.fullName || 'Player',position,role,status,
            reason,updatedAt:row.date || null,comment:row.shortComment || '',
            source:row.athlete?.links?.find(l=>l.href?.startsWith('https://www.espn.com/'))?.href || 'https://www.espn.com/nfl/injuries',
            rank:qb+importance+(severity[status.toLowerCase()]||0),key:importance>0 && (severity[status.toLowerCase()]||0)>=2};
    }).sort((a,b)=>b.rank-a.rank || a.name.localeCompare(b.name));
}

function createInsights({db,cacheDir,now=()=>Date.now(),fetchJson=async url=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error(`ESPN HTTP ${response.status}`);
    return response.json();
}}) {
    const cache=new Map(),pending=new Map();
    async function cached(url,ttl) {
        let entry=cache.get(url);
        const file=cacheDir && path.join(cacheDir,crypto.createHash('sha256').update(url).digest('hex')+'.json');
        if(!entry && file) {try {entry=JSON.parse(fs.readFileSync(file,'utf8'));cache.set(url,entry);}catch {}}
        if(entry && now()-entry.fetchedAt<ttl) return entry.data;
        if(pending.has(url)) return pending.get(url);
        const promise=(async()=>{
            const data=await fetchJson(url);const value={data,fetchedAt:now()};cache.set(url,value);
            if(file) {try{fs.mkdirSync(cacheDir,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file);}catch { /* Cache failure must not break the popup. */ }}
            return data;
        })();
        pending.set(url,promise);
        try{return await promise;}finally{pending.delete(url);}
    }
    async function get(gameId) {
        const game=db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
        if(!game) return null;
        const warnings=[];
        const safe=async(url,ttl)=>{try{return await cached(url,ttl);}catch{warnings.push('Some ESPN data is unavailable.');return null;}};
        const all=db.prepare('SELECT * FROM games WHERE season BETWEEN ? AND ? AND season_type = 2').all(game.season-5,game.season);
        const summary=await safe(`${BASE}/summary?event=${encodeURIComponent(game.id)}`,5*60*1000);
        const competitors=summary?.header?.competitions?.[0]?.competitors || [];
        const ids=[game.away_team,game.home_team].map(name=>competitors.find(c=>c.team?.displayName===name)?.team?.id);
        const history=[...all];
        // Fetch older meetings independently of the application's picks database.
        if(ids[0]) {
            const schedules=await Promise.all([0,1,2,3,4,5].map(offset=>safe(`${BASE}/teams/${ids[0]}/schedule?season=${game.season-offset}&seasontype=2`,offset===0 ? 10*60*1000 : 24*60*60*1000)));
            schedules.forEach((data,index)=>{if(data){try{history.push(...normalizeSchedule(data,game.season-index));}catch{warnings.push('Historical schedule context could not be verified.');}}});
        } else warnings.push('Historical ESPN schedules are unavailable; showing stored results.');
        const distinct=Array.from(new Map(history.map(row=>[row.id,row])).values());
        // Reuse logos already present in schedules and the game summary; no extra API calls.
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
        for(const competitor of competitors) {
            const team=competitor.team;
            if(team?.displayName) teams[team.displayName]={name:team.displayName,
                abbr:team.abbreviation || teams[team.displayName]?.abbr || team.displayName,
                logo:team.logo || team.logos?.[0]?.href || teams[team.displayName]?.logo || ''};
        }
        const previous=priorGames(distinct,game);
        const meetings=previous.filter(g=>(g.away_team===game.away_team && g.home_team===game.home_team)||(g.home_team===game.away_team && g.away_team===game.home_team))
            .sort((a,b)=>Date.parse(b.game_date)-Date.parse(a.game_date)).slice(0,5).map(g=>({ ...teamResult(g,game.away_team),awayTeam:g.away_team,homeTeam:g.home_team,awayScore:g.away_score,homeScore:g.home_score }));
        const current=game.status!=='final' && Math.abs(Date.parse(game.game_date)-now())<8*24*60*60*1000;
        let injuries={available:false,note:'Current injury reports are shown only for games within eight days of kickoff, not historical matchups.',teams:[]};
        if(current) {
            const report=await safe(`${BASE}/injuries`,10*60*1000);
            if(report && Number(report.season?.year)===Number(game.season)) {
                const teams=await Promise.all([game.away_team,game.home_team].map(async(name,index)=>{
                    const teamId=ids[index];
                    const rows=report.injuries?.find(t=>t.displayName===name)?.injuries;
                    const last=priorGames(all,game).filter(g=>g.away_team===name || g.home_team===name).sort((a,b)=>Date.parse(b.game_date)-Date.parse(a.game_date))[0];
                    const [depth,lastSummary]=await Promise.all([
                        teamId ? safe(`${BASE}/teams/${teamId}/depthcharts`,6*60*60*1000) : null,
                        teamId && last && now()-Date.parse(last.game_date)<35*24*60*60*1000 ? safe(`${BASE}/summary?event=${last.id}`,24*60*60*1000) : null
                    ]);
                    const validDepth=Number(depth?.season?.year)===Number(game.season) ? depth : null;
                    return {name,available:Array.isArray(rows),players:rankInjuries(rows || [],validDepth,recentRoles(lastSummary,teamId)),
                        roleNote:validDepth ? 'Prioritized by listed starters and recent offensive leaders. Depth charts may lag changes.' : 'Depth chart unavailable; some player roles could not be confirmed.'};
                }));
                injuries={available:true,updatedAt:report.timestamp,note:'Latest reported status; Questionable does not mean ruled out. Expand to see players whose roles are unconfirmed.',teams};
            } else injuries.note='A current injury report for this season is unavailable.';
        }
        const recent=[game.away_team,game.home_team].map(name=>({name,games:priorGames(all.filter(g=>g.season===game.season),game)
            .filter(g=>g.away_team===name || g.home_team===name).sort((a,b)=>Date.parse(b.game_date)-Date.parse(a.game_date)).slice(0,3).map(g=>teamResult(g,name))}));
        return {gameId:game.id,season:game.season,seasonType:game.season_type,kickoff:game.game_date,generatedAt:new Date(now()).toISOString(),
            teams,injuries,meetings,historyNote:'Regular-season meetings in the selected season and previous five seasons, before this matchup.',
            commonOpponents:commonOpponents(all,game),recent,warnings:[...new Set(warnings)],
            source:`https://www.espn.com/nfl/game/_/gameId/${game.id}`};
    }
    return {get};
}
module.exports={createInsights,athleteId,priorGames,teamResult,commonOpponents,normalizeSchedule,recentRoles,rankInjuries};
