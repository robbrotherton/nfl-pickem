const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createStore(cacheDir, now) {
    if(cacheDir) fs.mkdirSync(cacheDir,{recursive:true});
    // Separate ESPN metadata and retained pregame history; never app picks or users.
    const db=new Database(cacheDir ? path.join(cacheDir,'insights.db') : ':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT, abbr TEXT, logo TEXT, updated_at INTEGER);
        CREATE TABLE IF NOT EXISTS snapshots (game_id TEXT, team_id TEXT, season INTEGER, season_type INTEGER,
            week INTEGER, scope TEXT, players TEXT, fetched_at INTEGER, PRIMARY KEY(game_id,team_id));
        CREATE TABLE IF NOT EXISTS responses (url TEXT PRIMARY KEY, data TEXT, fetched_at INTEGER, version TEXT, retry_after INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS availability (game_id TEXT, team_id TEXT, season INTEGER, season_type INTEGER,
            kickoff TEXT, captured_at INTEGER, data TEXT, PRIMARY KEY(game_id,team_id));
    `);
    const saveTeam=db.prepare(`INSERT INTO teams VALUES (@id,@name,@abbr,@logo,@updated_at)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,abbr=excluded.abbr,logo=excluded.logo,updated_at=excluded.updated_at`);
    function team(value) {
        if(!/^\d+$/.test(String(value?.id || '')) || !value.displayName) return;
        const old=db.prepare('SELECT * FROM teams WHERE id=?').get(String(value.id));
        saveTeam.run({id:String(value.id),name:value.displayName,abbr:value.abbreviation || old?.abbr || '',
            logo:value.logo || value.logos?.[0]?.href || old?.logo || '',updated_at:now()});
    }
    function resolve(name,abbr) {
        return db.prepare('SELECT * FROM teams WHERE name=? OR (abbr != ? AND abbr=?) ORDER BY updated_at DESC LIMIT 1').get(name,'',abbr==='WAS'?'WSH':abbr || '');
    }
    function ingestScoreboard(data) {
        for(const event of data.events || []) {
            const season=Number(event.season?.year || data.season?.year),type=Number(event.season?.type || data.season?.type);
            if(!Number.isInteger(season) || ![1,2,3].includes(type)) continue;
            const competition=event.competitions?.[0];
            for(const competitor of competition?.competitors || []) {
                team(competitor.team);
                if(!competitor.team?.id) continue;
                const scope=competition.status?.type?.completed || competition.status?.type?.state==='in' ? 'game' : 'season';
                db.prepare(`INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?,?,?,?)`).run(String(event.id),String(competitor.team.id),season,type,
                    Number(event.week?.number || data.week?.number || 0),scope,JSON.stringify(competitor.leaders || []),now());
            }
        }
    }
    function leaders(gameId,teamId) {
        return db.prepare('SELECT * FROM snapshots WHERE game_id=? AND team_id=?').get(String(gameId),String(teamId));
    }
    function roles(teamId,season) {
        const rows=db.prepare('SELECT players FROM snapshots WHERE team_id=? AND season=? AND season_type=2 ORDER BY fetched_at DESC LIMIT 8').all(String(teamId),season);
        const result=new Map();
        for(const row of rows) for(const category of JSON.parse(row.players)) for(const leader of category.leaders || []) {
            const id=leader.athlete?.id;if(id) result.set(String(id),'Saved team leader');
        }
        return result;
    }
    function read(url) {
        const row=db.prepare('SELECT * FROM responses WHERE url=?').get(url);
        if(row) return {...row,data:JSON.parse(row.data)};
        // Reuse the old preview cache once, avoiding an unnecessary refetch after this upgrade.
        if(cacheDir) {
            try {
                const file=path.join(cacheDir,crypto.createHash('sha256').update(url).digest('hex')+'.json');
                const value=JSON.parse(fs.readFileSync(file,'utf8'));
                write(url,value.data,value.fetchedAt,'');return read(url);
            }catch {}
        }
        return null;
    }
    function write(url,data,fetchedAt=now(),version='') {
        db.prepare('INSERT OR REPLACE INTO responses VALUES (?,?,?,?,0)').run(url,JSON.stringify(data),fetchedAt,version);
    }
    function failed(url) {
        db.prepare(`INSERT INTO responses VALUES (?,'null',0,'',?) ON CONFLICT(url) DO UPDATE SET retry_after=excluded.retry_after`).run(url,now()+5*60*1000);
    }
    function saveAvailability(game, teamId, context) {
        // Never reconstruct or overwrite a game's pregame report after kickoff.
        if (!teamId || game.season_type !== 2 || now() >= Date.parse(game.game_date)) return;
        const previous = availability(game, teamId);
        if (previous && (previous.capturedAt > context.capturedAt || previous.injuryUpdatedAt > context.injuryUpdatedAt ||
            previous.depthUpdatedAt > context.depthUpdatedAt)) return;
        db.prepare(`INSERT OR REPLACE INTO availability VALUES (?,?,?,?,?,?,?)`).run(
            String(game.id), String(teamId), game.season, game.season_type, game.game_date, context.capturedAt, JSON.stringify(context));
    }
    function availability(game, teamId) {
        const row = db.prepare('SELECT * FROM availability WHERE game_id=? AND team_id=? AND season=? AND season_type=? AND kickoff=?')
            .get(String(game.id), String(teamId), game.season, game.season_type, game.game_date);
        return row ? JSON.parse(row.data) : null;
    }
    return {team,resolve,ingestScoreboard,leaders,roles,read,write,failed,availability,saveAvailability,close:()=>db.close()};
}
module.exports={createStore};
