const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const Database = require('better-sqlite3');
const express = require('express');
const seasons = require('../public/season-context');

// The real routes run against an in-memory database with ESPN fully stubbed.
// No production server, database, network request, or migration is used.
let app, db, scoreboard, requestedWeeks = [];
const quiet = { log() {}, warn() {}, error() {} };
const fakeExpress = () => {
    app = express();
    app.listen = () => {};
    return app;
};
Object.assign(fakeExpress, express);
const fakeHttps = {
    get(url, callback) {
        const request = new EventEmitter();
        process.nextTick(() => {
            const query = new URL(url).searchParams;
            requestedWeeks.push(Number(query.get('week')));
            const payload = scoreboard(query);
            const response = new EventEmitter();
            response.statusCode = 200;
            callback(response);
            response.emit('data', JSON.stringify(payload));
            response.emit('end');
        });
        return request;
    }
};
const root = path.resolve(__dirname, '..');
vm.runInNewContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), {
    require(name) {
        if (name === 'express') return fakeExpress;
        if (name === 'better-sqlite3') return function () { return db = new Database(':memory:'); };
        if (name === 'https') return fakeHttps;
        if (name === './public/season-context.js') return seasons;
        if (name.startsWith('./lib/')) return require(path.join(root, name));
        return require(name);
    },
    __dirname: root,
    URLSearchParams, AbortSignal,
    fetch: async url => ({ ok: true, json: async () => scoreboard(new URL(url).searchParams) }),
    console: quiet,
    process: { env: {}, on() {} },
    setTimeout(callback) { callback(); }
});
const game = (id, season, type, week = 1) => ({
    id, season, season_type: type, week, away_team: 'Chicago Bears', home_team: 'Detroit Lions',
    away_abbr: 'CHI', home_abbr: 'DET', game_date: `${season}-09-10T18:00:00Z`, status: 'scheduled'
});
(async () => {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(route, method = 'GET', body) {
        const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    }
    try {
        for (const row of [game('pre',2026,1),game('reg',2026,2),game('post',2026,3),game('old',2025,2)]) {
            assert.equal((await call('/api/games','POST',row)).status,200);
        }
        const ids = result => result.body.map(g => g.id);
        assert.deepEqual(ids(await call('/api/games/2026/team/Chicago%20Bears')), ['reg']);
        assert.deepEqual(ids(await call('/api/games/2026/team/Chicago%20Bears?season_type=1')), ['pre']);
        assert.deepEqual(ids(await call('/api/games/2026/1')), ['reg']);
        assert.deepEqual(ids(await call('/api/games/2026/1?season_type=3')), ['post']);
        assert.deepEqual(ids(await call('/api/games/2026/1?playoff=1')), ['post']);
        assert.equal((await call('/api/games/2026/1?playoff=1&season_type=2')).status,400);
        for (const type of ['bad','0','4','2junk','', '2&season_type=3']) {
            assert.equal((await call(`/api/games/2026/1?season_type=${type}`, 'DELETE')).status,400);
            assert.equal(db.prepare('SELECT COUNT(*) n FROM games').get().n,4);
        }
        for (const route of ['/api/games/2026junk/1','/api/games/2026/1junk','/api/games/2026/team/Chicago%20Bears?season_type=bad','/api/games/2026/18?season_type=1','/api/games/2020/18?season_type=2','/api/games/2026/6?season_type=3']) {
            assert.equal((await call(route)).status,400);
        }
        assert.equal((await call('/api/games','POST',game('reg',2026,1))).status,409);
        assert.equal((await call('/api/games','POST',game('reg',2025,2))).status,409);
        assert.equal((await call('/api/week-players','POST',{player_name:'Test'})).status,400);
        assert.equal((await call('/api/games','POST',game('bad-week',2026,1,18))).status,400);
        const pick = { player_name: 'Test',game_id: 'reg',season:2026,week:1,season_type:2,picked_team:'Chicago Bears' };
        for (const change of [{season:2025},{week:2},{season_type:1},{game_id:'missing'},{picked_team:'Other Team'}]) {
            assert.equal((await call('/api/picks','POST',{...pick,...change})).status,400);
        }
        for (const [id,type] of [['pre',1],['reg',2],['post',3]]) {
            assert.equal((await call('/api/picks','POST',{...pick,game_id:id,season_type:type})).status,200);
            db.prepare('UPDATE picks SET is_correct = 1 WHERE game_id = ?').run(id);
        }
        assert.equal((await call('/api/leaderboard/2026')).body[0].weeks_played,3);
        assert.equal((await call('/api/leaderboard/2026/1?season_type=2')).body[0].wins,1);
        assert.equal((await call('/api/picks/2026/1?season_type=1')).body[0].game_id,'pre');
        for (const type of [1,2,3]) {
            assert.equal((await call('/api/week-players','POST',{season:2026,week:1,season_type:type,player_name:'Test',display_order:type})).status,200);
        }
        await call('/api/week-players/2026/1/Test?season_type=1','DELETE');
        assert.equal((await call('/api/week-players/2026/1?season_type=1')).body.length,0);
        assert.equal((await call('/api/week-players/2026/1?season_type=2')).body.length,1);
        await call('/api/games/2026/1','DELETE');
        assert.deepEqual(db.prepare('SELECT id FROM games ORDER BY id').all().map(g=>g.id), ['old','post','pre']);

        scoreboard = q => ({season:{year:Number(q.get('dates')),type:Number(q.get('seasontype'))},week:{number:Number(q.get('week'))},events:[]});
        assert.equal((await call('/api/espn/scoreboard?dates=2026&week=4&seasontype=2')).status,200);
        for (const query of ['url=https://evil.invalid', 'dates=2026junk', 'week=0', 'seasontype=4', 'dates=2026&week=18&seasontype=1']) {
            assert.equal((await call('/api/espn/scoreboard?' + query)).status,400);
        }
        requestedWeeks=[];
        assert.equal((await call('/api/season/2027/seed?season_type=3','POST')).status,200);
        assert.deepEqual(requestedWeeks,[1,2,3,4,5]);
        requestedWeeks=[];
        await call('/api/season/2020/seed','POST');
        assert.equal(requestedWeeks.length,17);
        requestedWeeks=[];
        await call('/api/season/2026/seed?season_type=1','POST');
        assert.deepEqual(requestedWeeks,[2,3,4]); // Hall of Fame week with one game is already cached.
        scoreboard = () => ({season:{year:2026,type:2},week:{number:1},events:[{id:'pre'}]});
        assert.equal((await call('/api/season/2026/seed','POST')).status,500);
        assert.equal(db.prepare('SELECT season_type FROM games WHERE id = ?').get('pre').season_type,1);
        scoreboard = () => ({season:{year:2026,type:2},week:{number:2},events:[]});
        assert.equal((await call('/api/season/2026/seed','POST')).status,500);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM games').get().n,3);
        // Completed regular-season records exclude preseason and postseason wins.
        db.prepare('UPDATE games SET status = ?, away_score = 7, home_score = 0, winner = away_team').run('final');
        assert.ok(Object.values((await call('/api/conference-records/2026')).body).every(row => row.wins === 0 && row.losses === 0));
        console.log('seasons.test.cjs: API regressions passed');
    } finally {
        await new Promise(resolve => server.close(resolve));
        db.close();
    }

    assert.equal(seasons.weekCount(2019,1),5);
    assert.equal(seasons.weekCount(2026,1),4);
    assert.equal(seasons.fallbackSeasonYear(new Date(2027,0,15)),2026);
    assert.equal(seasons.fallbackSeasonYear(new Date(2027,8,15)),2027);
    for (const data of [
        {season:{year:2025,type:2}}, {season:{year:2026,type:1}}, {week:{number:2}},
        {events:[{season:{year:2025}}]}, {events:[{season:{type:1}}]}, {events:[{week:{number:2}}]}
    ]) assert.throws(()=>seasons.assertScoreboardContext(data,2026,1,2));
    // A January kickoff still belongs to the season's start year.
    seasons.assertScoreboardContext({season:{year:2026,type:3},week:{number:1},events:[{date:'2027-01-10'}]},2026,1,3);

    const elements = new Map(['gameHistoryModal','gameHistoryTitle','gameHistoryBody','weekSelectTitle'].map(id=>[id,{classList:{add(){}},value:'2:1'}]));
    const client = vm.createContext({NFLSeason:seasons,console:quiet,Date,Map,window:{addEventListener(){}}, document:{getElementById:id=>elements.get(id)}});
    vm.runInContext(fs.readFileSync(path.join(root,'public/app.js'),'utf8'),client);
    const urls=[];
    client.fetch=async url=>{urls.push(url);return {ok:true,json:async()=>[]};};
    await vm.runInContext("showGameHistoryModal('Chicago Bears','Detroit Lions',2026)",client);
    assert.ok(urls.every(url=>url.endsWith('?season_type=2')));
    assert.match(elements.get('gameHistoryTitle').textContent,/2026 Matchup/);
    client.fetch=async(url,options)=>{urls.push([url,options]);return {ok:true,json:async()=>({season:{year:2026,type:1},week:{number:1},events:[{}]})};};
    urls.length=0;
    await assert.rejects(vm.runInContext('fetchAndCacheGames(1,2026,2)',client),/season type/);
    assert.equal(urls.length,1); // No writes on a mismatched response.
    await assert.rejects(vm.runInContext('forceRefreshSchedule()',client),/season type/);
    assert.ok(urls.every(([,options])=>options?.method!=='DELETE'));
    vm.runInContext('currentSeason=2020;cachedSeasonInfo={seasonYear:2026,seasonType:2,weekNumber:4}',client);
    assert.equal(await vm.runInContext('getCurrentWeekSelection()',client),'2:17');
    assert.equal(vm.runInContext('buildWeekOptions(null).filter(w=>w.seasonType===2).length',client),17);
    vm.runInContext('currentSeason=2026;cachedSeasonInfo={seasonYear:2026,seasonType:3,weekNumber:2}',client);
    assert.equal(await vm.runInContext('getCurrentWeekSelection()',client),'3:2');
    assert.equal(await vm.runInContext('getPreferredSeasonYear(2027)',client),2026);
    client.fetch=async url=>{urls.push(url);return {ok:true,json:async()=>({season:{year:2020,type:2},week:{number:1},leagues:[{calendar:[{value:'2',entries:[{value:'17'}]}]}]})};};
    urls.length=0;
    await vm.runInContext('getSeasonCalendar(2020)',client);
    assert.match(urls[0],/dates=2020/);
    console.log('seasons.test.cjs: browser and season-context regressions passed');
})().catch(error => {console.error(error);process.exitCode=1;});
