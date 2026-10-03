const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const {createInsights,rankInjuries,athleteId,commonOpponents,normalizeSchedule,playerHighlights}=require('../lib/matchup-insights');
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
const categories=[
 {name:'passingLeader',leaders:[{athlete:{id:'removed'},displayValue:'55/80, 700 YDS, 6 TD, 1 INT'}]},
 {name:'quarterbackRating',leaders:[{athlete:{id:'removed'},displayValue:'108.2'}]},
 {name:'sacks',leaders:[{athlete:{id:'def'},value:3,displayValue:'3'}]},
 {name:'totalTackles',leaders:[{athlete:{id:'def'},value:20,displayValue:'20'}]}
];
depth.depthchart[0].positions.de={position:{abbreviation:'DE'},athletes:[{id:'def',displayName:'Defender',position:{abbreviation:'DE'}}]};
const bootstrap={season:{year:2026,type:2},week:{number:4},events:[{id:'target',season:{year:2026,type:2},competitions:[{status:{type:{state:'pre'}},competitors:[
 {team:{displayName:'Team A',abbreviation:'A',id:'1'},leaders:[]},
 {team:{displayName:'Team B',abbreviation:'B',id:'2'},leaders:[]}
]}]}]};
const urls=[];
let clock=kickoff-24*60*60*1000;
const responses=async url=>{
 requests++;urls.push(url);
 if(url.includes('/injuries')) return {season:{year:2026},timestamp:'2026-10-03T10:00:00Z',injuries:[{id:'1',displayName:'Team A',injuries},{id:'2',displayName:'Team B',injuries:[]}]};
 if(url.includes('/depthcharts')) return depth;
 if(url.includes('/schedule?')) return {season:{year:Number(new URL(url).searchParams.get('season')),type:2},events:[]};
 if(url.includes('/leaders?')) return {categories};
 if(url.includes('/teams?')) return {sports:[{leagues:[{teams:[{team:{id:'1',displayName:'Team A'}},{team:{id:'2',displayName:'Team B'}}]}]}]};
 throw new Error('Unexpected request '+url);
};
const service=createInsights({db,now:()=>clock,fetchJson:responses});
service.ingestScoreboard(bootstrap);
(async()=>{
 try {
  const result=await service.get('target');
  assert.equal(result.meetings.length,1);assert.equal(result.meetings[0].result,'T');assert.equal(result.meetings[0].id,'meeting');
  assert.equal(result.commonOpponents.length,1);assert.equal(result.injuries.available,true);
  assert.equal(result.injuries.teams[0].players[0].id,'qb');assert.ok(result.injuries.teams[0].players.find(p=>p.id==='removed').key);
  assert.equal(result.watch.teams[0].players[0].name,'Previous QB');
  assert.equal(result.watch.teams[0].players[0].metrics[1].display,'108.2');
  assert.ok(result.watch.teams[0].players.some(p=>p.name==='Defender'));
  assert.ok(urls.every(url=>!url.includes('/summary?') && !url.includes('/teams?')));
  const count=requests;await service.get('target');assert.equal(requests,count);
  // A locally complete season needs no historical schedule request.
  const coveredDb=new Database(':memory:');
  coveredDb.exec(db.prepare("SELECT sql FROM sqlite_master WHERE name='games'").get().sql);
  const coveredInsert=coveredDb.prepare('INSERT INTO games VALUES (@id,@season,@season_type,@week,@game_date,@away_team,@home_team,@away_score,@home_score,@status)');
  rows.forEach(row=>coveredInsert.run(row));
  for(let week=1;week<=16;week++) coveredInsert.run({...game,id:'covered-'+week,season:2025,week,game_date:'2025-10-04T17:00:00Z',status:'final',away_score:21,home_score:17});
  const coveredUrls=[];
  const covered=createInsights({db:coveredDb,now:()=>clock,fetchJson:async url=>{coveredUrls.push(url);return responses(url);}});
  covered.ingestScoreboard(bootstrap);await covered.get('target');
  assert.ok(!coveredUrls.some(url=>url.includes('/schedule?season=2025&')));
  covered.close();coveredDb.close();
  assert.equal(await service.get('unknown'),null);
  const old=await service.get('meeting');assert.equal(old.injuries.available,false);
  const failure=createInsights({db,now:()=>kickoff-24*60*60*1000,fetchJson:async()=>{throw new Error('Offline');}});
  const offline=await failure.get('target');assert.equal(offline.commonOpponents.length,1);assert.equal(offline.meetings.length,1);assert.ok(offline.warnings.length);
  const wrongYear=createInsights({db,now:()=>clock,fetchJson:async url=>url.includes('/injuries')?{season:{year:2025}}:responses(url)});
  wrongYear.ingestScoreboard(bootstrap);
  assert.equal((await wrongYear.get('target')).injuries.available,false);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM games').all()),snapshot);
  // A stale injury report remains useful if ESPN is offline, and retries are bounded.
  clock+=11*60*1000;
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-insights-'));
  try {
   let upstream=0;
   const first=createInsights({db,cacheDir:dir,now:()=>clock,fetchJson:async url=>{upstream++;return responses(url);}});
   first.ingestScoreboard(bootstrap);await first.get('target');first.close();
   const before=upstream;
   const restored=createInsights({db,cacheDir:dir,now:()=>clock,fetchJson:async()=>{upstream++;throw new Error('Offline');}});
   const warm=await restored.get('target');assert.equal(upstream,before);assert.equal(warm.watch.teams[0].players.length,2);
   clock+=11*60*1000;
   const stale=await restored.get('target');assert.equal(stale.injuries.available,true);assert.ok(stale.warnings.some(w=>w.includes('saved data')));
   const after=upstream;await restored.get('target');assert.equal(upstream,after);restored.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  failure.close();wrongYear.close();
  console.log('matchup-insights.test.cjs: saved IDs, player leaders, restart persistence, stale fallback, cooldowns, no summary calls, and read-only game data passed');
 } finally {service.close();db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
