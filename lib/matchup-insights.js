const { createStore } = require('./insights-store');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

function athleteId(athlete = {}) {
    return String(athlete.id || athlete.$ref?.match(/\/athletes\/(\d+)/)?.[1] || athlete.links?.map(link => link.href?.match(/\/id\/(\d+)/)?.[1]).find(Boolean) || '');
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
function playerHighlights(categories,depth,injuryRows=[],savedCategories=[]) {
    const athletes=new Map();
    for(const formation of depth?.depthchart || []) for(const slot of Object.values(formation.positions || {}))
        for(const athlete of slot.athletes || []) athletes.set(athleteId(athlete),athlete);
    for(const row of injuryRows) if(athleteId(row.athlete)) athletes.set(athleteId(row.athlete),{...athletes.get(athleteId(row.athlete)),...row.athlete});
    for(const category of [...savedCategories,...categories]) for(const leader of category.leaders || [])
        if(leader.athlete?.displayName || leader.athlete?.fullName) athletes.set(athleteId(leader.athlete),leader.athlete);
    const result=[];
    const add=(category,label)=>{
        const entry=categories.find(c=>c.name===category)?.leaders?.[0];
        if(!entry) return false;
        const id=athleteId(entry.athlete),athlete=athletes.get(id);
        if(!athlete || result.some(row=>row.id===id)) return false;
        const status=injuryRows.find(row=>athleteId(row.athlete)===id)?.status;
        const metrics=[{label,display:entry.displayValue || String(entry.value ?? '')}];
        const extras=category==='passingLeader' ? ['quarterbackRating'] : category==='sacks' ? ['totalTackles','interceptions'] : [];
        for(const extra of extras) {
            const stat=categories.find(c=>c.name===extra)?.leaders?.find(row=>athleteId(row.athlete)===id);
            if(stat) metrics.push({label:{quarterbackRating:'Passer rating',totalTackles:'Tackles',interceptions:'Interceptions'}[extra],display:stat.displayValue || String(stat.value)});
        }
        result.push({id,name:athlete.displayName || athlete.fullName,position:athlete.position?.abbreviation || '',
            headshot:typeof athlete.headshot==='string' ? athlete.headshot : athlete.headshot?.href,
            label,status:['Active','Healthy'].includes(status)?null:status,metrics,
            source:athlete.links?.find(link=>link.href?.startsWith('https://www.espn.com/'))?.href || `https://www.espn.com/nfl/player/_/id/${id}`});
        return true;
    };
    add('passingLeader','Passing leader');add('receivingLeader','Receiving leader');
    const sacks=categories.find(c=>c.name==='sacks')?.leaders?.[0];
    if(!(sacks && Number(sacks.value)>0 && add('sacks','Sacks leader'))) {
        if(!add('totalTackles','Tackles leader')) add('rushingLeader','Rushing leader');
    }
    if(result.length<3) add('rushingLeader','Rushing leader');
    return result.slice(0,3);
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
    const store=createStore(cacheDir,now),pending=new Map();
    async function cached(url,ttl,{version='',validate=()=>{},onStale=()=>{}}={}) {
        let entry=store.read(url);
        if(entry?.data) {
            try {validate(entry.data);} catch {entry={...entry,data:null};}
        }
        if(entry?.data && entry.version===version && now()-entry.fetched_at<ttl) return entry.data;
        if(entry && entry.retry_after>now()) {if(!entry.data) throw new Error('Retry deferred');onStale();return entry.data;}
        if(pending.has(url)) return pending.get(url);
        const promise=(async()=>{
            try {
                const data=await fetchJson(url);validate(data);store.write(url,data,now(),version);return data;
            }catch(error) {
                store.failed(url);
                if(entry?.data) {onStale();return entry.data;}
                throw error;
            }
        })();
        pending.set(url,promise);
        try{return await promise;}finally{pending.delete(url);}
    }
    async function get(gameId) {
        const game=db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
        if(!game) return null;
        const warnings=[];
        const safe=async(url,ttl,options={})=>{
            try{return await cached(url,ttl,{...options,onStale:()=>warnings.push('Some ESPN data could not be refreshed; saved data is shown with its earlier update time.')});}
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
        const current=game.status!=='final' && Math.abs(Date.parse(game.game_date)-now())<8*24*60*60*1000;
        let injuries={available:false,note:'Current injury reports are shown only for games within eight days of kickoff, not historical matchups.',teams:[]};
        let watch={teams:[],note:'Players to watch are shown for upcoming matchups near kickoff, using current regular-season totals.'};
        if(current) {
            const report=await safe(`${BASE}/injuries`,10*60*1000,{validate:data=>{
                if(Number(data.season?.year)!==Number(game.season)) throw new Error('Injury report context mismatch');
            }});
            const contexts=await Promise.all(names.map(async(name,index)=>{
                const teamId=ids[index];
                const rows=report?.injuries?.find(t=>String(t.id)===teamId || t.displayName===name)?.injuries || [];
                const snapshot=store.leaders(game.id,teamId);
                const saved=snapshot?.scope==='season' && snapshot.season===game.season && snapshot.season_type===2 ? JSON.parse(snapshot.players) : [];
                const last=priorGames(all,game).filter(g=>g.away_team===name || g.home_team===name).sort((a,b)=>Date.parse(b.game_date)-Date.parse(a.game_date))[0];
                const core=`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${game.season}/types/2/teams/${teamId}/leaders?lang=en&region=us`;
                const [depth,leaders]=teamId ? await Promise.all([
                    safe(`${BASE}/teams/${teamId}/depthcharts`,24*60*60*1000,{validate:data=>{
                        if(Number(data.season?.year)!==game.season) throw new Error('Depth chart context mismatch');
                    }}),
                    safe(core,12*60*60*1000,{version:last?.id || 'no-final-games',validate:data=>{
                        if(!Array.isArray(data.categories)) throw new Error('Player leaders unavailable');
                        if(data.$ref && !data.$ref.includes(`/seasons/${game.season}/types/2/teams/${teamId}/`)) throw new Error('Player leader context mismatch');
                    }})
                ]) : [null,null];
                const roleMap=store.roles(teamId,game.season);
                const highlights=playerHighlights(leaders?.categories?.length ? leaders.categories : saved,depth,rows,saved);
                for(const player of highlights) roleMap.set(player.id,'Team season leader');
                return {name,rows,depth,players:rankInjuries(rows,depth,roleMap),highlights,
                    statsUpdatedAt:store.read(core)?.fetched_at || snapshot?.fetched_at || null,
                    roleNote:depth ? 'Prioritized by listed starters and saved team leaders. Depth charts may lag changes.' : 'Depth chart unavailable; some player roles could not be confirmed.'};
            }));
            watch.teams=contexts.map(team=>({name:team.name,players:team.highlights,updatedAt:team.statsUpdatedAt}));
            if(report && Number(report.season?.year)===Number(game.season)) {
                injuries={available:true,updatedAt:report.timestamp,note:'Latest reported status; Questionable does not mean ruled out. Expand to see players whose roles are unconfirmed.',
                    teams:contexts.map(team=>({name:team.name,available:!!report.injuries?.find(t=>t.displayName===team.name),players:team.players,roleNote:team.roleNote}))};
            } else injuries.note='A current injury report for this season is unavailable.';
        }
        const recent=[game.away_team,game.home_team].map(name=>({name,games:priorGames(all.filter(g=>g.season===game.season),game)
            .filter(g=>g.away_team===name || g.home_team===name).sort((a,b)=>Date.parse(b.game_date)-Date.parse(a.game_date)).slice(0,3).map(g=>teamResult(g,name))}));
        return {gameId:game.id,season:game.season,seasonType:game.season_type,kickoff:game.game_date,generatedAt:new Date(now()).toISOString(),
            teams,watch,injuries,meetings,historyNote:'Regular-season meetings in the selected season and previous five seasons, before this matchup.',
            commonOpponents:commonOpponents(all,game),recent,warnings:[...new Set(warnings)],
            source:`https://www.espn.com/nfl/game/_/gameId/${game.id}`};
    }
    return {get,ingestScoreboard:store.ingestScoreboard,close:store.close};
}
module.exports={createInsights,athleteId,priorGames,teamResult,commonOpponents,normalizeSchedule,playerHighlights,rankInjuries};
