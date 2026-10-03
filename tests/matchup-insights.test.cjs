const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const {createInsights,rankInjuries,athleteId,commonOpponents,normalizeSchedule}=require('../lib/matchup-insights');
const db=new Database(':memory:');
db.exec('CREATE TABLE games (id TEXT, season INTEGER, season_type INTEGER, week INTEGER, game_date TEXT, away_team TEXT, home_team TEXT, away_score INTEGER, home_score INTEGER, status TEXT)');
const insert=db.prepare('INSERT INTO games VALUES (@id,@season,@season_type,@week,@game_date,@away_team,@home_team,@away_score,@home_score,@status)');
const kickoff=Date.parse('2026-10-04T17:00:00Z');
const game={id:'target',season:2026,season_type:2,week:4,game_date:'2026-10-04T17:00:00Z',away_team:'Team A',home_team:'Team B',away_score:null,home_score:null,status:'scheduled'};
const rows=[game,
 {...game,id:'a-x',week:3,game_date:'2026-09-27T17:00:00Z',home_team:'Team X',away_score:24,home_score:17,status:'final'},
 {...game,id:'b-x',week:2,game_date:'2026-09-20T17:00:00Z',away_team:'Team B',home_team:'Team X',away_score:10,home_score:21,status:'final'},
 {...game,id:'pre',season_type:1,week:1,game_date:'2026-08-20T17:00:00Z',away_score:7,home_score:0,status:'final'},
 {...game,id:'meeting',season:2025,week:4,game_date:'2025-10-04T17:00:00Z',away_score:21,home_score:21,status:'final'},
 {...game,id:'future',week:10,game_date:'2026-11-04T17:00:00Z',away_score:0,home_score:7,status:'final'}];
rows.forEach(r=>insert.run(r));
const common=commonOpponents(rows,game);
assert.equal(common.length,1);assert.equal(common[0].away.result,'W');assert.equal(common[0].home.result,'L');
assert.equal(athleteId({links:[{href:'https://www.espn.com/nfl/player/_/id/123/example'}]}),'123');
const injuries=[
 {athlete:{id:'active',displayName:'Healthy player'},status:'Active'},
 {athlete:{id:'backup',displayName:'Backup QB',position:{abbreviation:'QB'}},status:'Out'},
 {athlete:{id:'qb',displayName:'Starter QB',position:{abbreviation:'QB'}},status:'Questionable'},
 {athlete:{id:'removed',displayName:'Previous QB',position:{abbreviation:'QB'}},status:'Out'}];
const depth={season:{year:2026},depthchart:[{positions:{qb:{position:{abbreviation:'QB'},athletes:[{id:'qb'},{id:'backup'}]}}}]};
const ranked=rankInjuries(injuries,depth,new Map([['removed','Recent leading passer']]));
assert.equal(ranked.length,3);assert.equal(ranked[0].id,'qb');assert.equal(ranked[0].status,'Questionable');assert.equal(ranked[1].id,'removed');assert.equal(ranked[2].key,false);
assert.throws(()=>normalizeSchedule({season:{year:2025,type:2}},2026),/mismatch/);
assert.deepEqual(normalizeSchedule({season:{year:2026,type:2},requestedSeason:{year:2023,type:2},events:[]},2023),[]);
assert.throws(()=>normalizeSchedule({requestedSeason:{year:2023,type:2},events:[{season:{year:2026}}]},2023),/mismatch/);
let requests=0;
const snapshot=JSON.stringify(db.prepare('SELECT * FROM games').all());
const data={
 header:{competitions:[{competitors:[{team:{displayName:'Team A',id:'1'}},{team:{displayName:'Team B',id:'2'}}]}]},
 boxscore:{players:[{team:{id:'1'},statistics:[{name:'passing',athletes:[{athlete:{id:'removed'}}]}]}]}
};
const service=createInsights({db,now:()=>kickoff-24*60*60*1000,fetchJson:async url=>{
 requests++;
 if(url.includes('/injuries')) return {season:{year:2026},timestamp:'2026-10-03T10:00:00Z',injuries:[{displayName:'Team A',injuries},{displayName:'Team B',injuries:[]}]};
 if(url.includes('/depthcharts')) return depth;
 if(url.includes('/schedule?')) return {season:{year:Number(new URL(url).searchParams.get('season')),type:2},events:[]};
 return data;
}});
(async()=>{
 try {
  const result=await service.get('target');
  assert.equal(result.meetings.length,1);assert.equal(result.meetings[0].result,'T');assert.equal(result.meetings[0].id,'meeting');
  assert.equal(result.commonOpponents.length,1);assert.equal(result.injuries.available,true);
  assert.equal(result.injuries.teams[0].players[0].id,'qb');assert.ok(result.injuries.teams[0].players.find(p=>p.id==='removed').key);
  const count=requests;await service.get('target');assert.equal(requests,count);
  assert.equal(await service.get('unknown'),null);
  const old=await service.get('meeting');assert.equal(old.injuries.available,false);
  const failure=createInsights({db,now:()=>kickoff-24*60*60*1000,fetchJson:async()=>{throw new Error('Offline');}});
  const offline=await failure.get('target');assert.equal(offline.commonOpponents.length,1);assert.equal(offline.meetings.length,1);assert.ok(offline.warnings.length);
  const wrongYear=createInsights({db,now:()=>kickoff-24*60*60*1000,fetchJson:async url=>url.includes('/injuries')?{season:{year:2025}}:data});
  assert.equal((await wrongYear.get('target')).injuries.available,false);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM games').all()),snapshot);
  console.log('matchup-insights.test.cjs: injury ranking, historical cutoffs, cache, failures, and read-only data passed');
 } finally {db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
