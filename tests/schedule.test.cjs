const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { teamContext } = require('../public/schedule-context');
const NFLSeason = require('../public/season-context');

const game = (id, away, home, record, extra = {}) => ({ id, season: 2026, season_type: 2, week: 7,
    away_team: away, home_team: home, away_record: record, home_record: record, ...extra });
const directory = Array.from({ length: 16 }, (_, i) => game(`directory${i}`, `Team ${2*i}`, `Team ${2*i+1}`, '0-0', { week: 1 }));
const week = directory.slice(0, 14).map(g => ({ ...g, id: `week${g.id}`, week: 7, away_record: '4-0' }));
const season = [...directory, ...week, game('latest', 'Team 0', 'Team 1', '5-0', { week: 5 }),
    game('wrong-season', 'Team 0', 'Team 1', '12-0', { season: 2025 }),
    game('preseason', 'Team 0', 'Team 1', '3-0', { season_type: 1 })];
assert.equal(teamContext(season, week, 2026, 7).records['Team 0'], '5-0');
assert.equal(teamContext(season.reverse(), week, 2026, 7).records['Team 0'], '5-0');
assert.equal(teamContext([game('tie', 'A', 'B', '4-1-1')], [], 2026, 7).records.A, '4-1-1');
assert.deepEqual(teamContext(season, week, 2026, 7).byes.map(t => t.name), ['Team 28', 'Team 29', 'Team 30', 'Team 31']);
assert.equal(teamContext(directory, directory, 2026, 1).byes.length, 0);
assert.equal(teamContext(week, week, 2026, 7).byes.length, 0); // No complete league directory.
assert.equal(teamContext(season, week.map(g => ({ ...g, season_type: 3 })), 2026, 7).byes.length, 0);

(async () => {
    const events = {}, timers = new Map();
    let timerId = 0;
    const button = { classList: { toggle() {} }, setAttribute() {} };
    const freshness = {};
    const elements = { scoreRefreshButton: button, scoreFreshness: freshness };
    const client = vm.createContext({ NFLSeason, AbortController, Date, Map,
        console: { warn() {} },
        setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
        clearTimeout(id) { timers.delete(id); },
        window: { addEventListener(name, fn) { events[name] = fn; } },
        document: { addEventListener(name, fn) { events[name] = fn; }, getElementById(id) { return elements[id]; } }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../public/app.js'), 'utf8'), client);
    client.fetch = (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const timed = vm.runInContext("scheduleFetch('/test')", client);
    [...timers.values()][0]();
    await assert.rejects(timed, /aborted/);
    assert.equal(timers.size, 0);
    const refreshing = vm.runInContext('refreshScheduleScores(7,2026,2,0,true)', client);
    assert.equal(button.disabled, true);
    events.pagehide();
    await refreshing;
    assert.equal(button.disabled, false);
    assert.equal(vm.runInContext('scoreRefresh', client), null);
    // A fresh click after resume must perform a new request and render its result.
    client.calls = [];
    vm.runInContext(`fetchAndCacheGames=async (week,season,type,options)=>{calls.push(options.force);return [{id:'fresh'}]};loadSchedule=async options=>{result=options.games}`, client);
    await vm.runInContext('refreshScheduleScores(7,2026,2,0,true)', client);
    assert.equal(client.calls[0], true);
    assert.equal(client.result[0].id, 'fresh');
    assert.equal(button.disabled, false);
    // Catch-up refreshes each unfinished week and scores its completed games.
    client.historyCalls = [];
    vm.runInContext(`scheduleFetch=async()=>[{season:2026,season_type:2,week:6},{season:2026,season_type:1,week:3}];
        fetchAndCacheGames=async (week,season,type)=>{historyCalls.push([week,season,type]); return [{id:String(week),status:'final',winner:'A'}]};
        scoreCompletedGames=async games=>{historyCalls.push(games[0].id)}`, client);
    await vm.runInContext('refreshPreviousScores(7,2026,2)', client);
    assert.equal(JSON.stringify(client.historyCalls), JSON.stringify([[6,2026,2],'6',[3,2026,1],'3']));
    // Failures on scheduled weeks also need a visible retry message.
    vm.runInContext("scoreRefreshError=true;displayedScoreGames=[{status:'scheduled'}];updateScoreRefreshHeader()", client);
    assert.equal(freshness.hidden, false);
    assert.match(freshness.textContent, /click to retry/);
    // Render the real schedule HTML: current records and byes precede results.
    elements.content = { innerHTML: '' };
    client.document.querySelector = () => null;
    client.document.querySelectorAll = () => [];
    client.NFLSchedule = { teamContext };
    client.seasonFixtures = season;
    client.weekFixtures = week;
    vm.runInContext("loadPicksForWeek=async()=>({});scheduleFetch=async()=>seasonFixtures;renderWeeklyLeaderboard=async()=>'<div id=results>Results</div>';initMatchupScrolling=()=>{};scoreRefreshError=false", client);
    // Restore the real render after the earlier refresh stub.
    await vm.runInContext('renderScheduleTable(weekFixtures,[],2026,7,2,scheduleLoadId)', client);
    assert.match(elements.content.innerHTML, /class="team-record">5-0</);
    assert.match(elements.content.innerHTML, /Teams on bye/);
    assert.ok(elements.content.innerHTML.indexOf('Teams on bye') < elements.content.innerHTML.indexOf('id=results'));
    console.log('schedule.test.cjs: latest records, byes, request timeout, mobile resume, retry, and visible failures passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
