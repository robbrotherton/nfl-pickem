const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createInsights } = require('../lib/matchup-insights');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfl-availability-'));
const db = new Database(':memory:');
db.exec('CREATE TABLE games (id TEXT, season INTEGER, season_type INTEGER, week INTEGER, game_date TEXT, away_team TEXT, home_team TEXT, away_score INTEGER, home_score INTEGER, status TEXT)');
const insert = db.prepare('INSERT INTO games VALUES (@id,@season,@season_type,@week,@game_date,@away_team,@home_team,@away_score,@home_score,@status)');
const game = { id: '100', season: 2026, season_type: 2, week: 4, game_date: '2026-10-04T17:00:00Z',
    away_team: 'Team A', home_team: 'Team B', away_score: null, home_score: null, status: 'scheduled' };
insert.run(game);
const kickoff = Date.parse(game.game_date);
let clock = kickoff - 24 * 60 * 60 * 1000, out = true;
const first = { id: '1', displayName: 'First QB', position: { abbreviation: 'QB' } };
const backup = { id: '2', displayName: 'Backup QB', position: { abbreviation: 'QB' } };
const missingReceiver = { id: '3', displayName: 'Injured receiving leader', position: { abbreviation: 'WR' } };
const depth = { season: { year: 2026 }, depthchart: [{ positions: { qb: { position: { abbreviation: 'QB' }, athletes: [first, backup] } } }] };
const categories = [{ name: 'passingLeader', leaders: [{ athlete: backup, displayValue: '500 YDS, 3 TD' }, { athlete: first, displayValue: '200 YDS' }] },
    { name: 'receivingLeader', leaders: [{ athlete: missingReceiver, value: 300, displayValue: '30 REC, 300 YDS' }] }];
const urls = [];
async function fetchJson(url) {
    urls.push(url);
    if (url.includes('/injuries')) return { season: { year: 2026 }, injuries: ['10', '20'].map((id, index) => ({ id,
        displayName: index ? 'Team B' : 'Team A', injuries: [{ athlete: first, status: out ? 'Out' : 'Active' }, { athlete: missingReceiver, status: 'Out' }] })) };
    if (url.includes('/depthcharts')) return depth;
    if (url.includes('/leaders?')) return { categories };
    if (url.includes('/schedule?')) return { requestedSeason: { year: Number(new URL(url).searchParams.get('season')), type: 2 }, events: [] };
    throw new Error('Unexpected request ' + url);
}
function scoreboard(game) {
    return { season: { year: 2026, type: 2 }, events: [{ id: game.id, date: game.game_date, season: { year: 2026, type: 2 },
        competitions: [{ status: { type: { state: 'pre' } }, competitors: [
            { team: { id: '10', displayName: 'Team A' } }, { team: { id: '20', displayName: 'Team B' } }
        ] }] }] };
}
let service;
(async () => {
    try {
        service = createInsights({ db, cacheDir: dir, now: () => clock, fetchJson });
        const beforeGames = JSON.stringify(db.prepare('SELECT * FROM games').all());
        await service.ingestScoreboard(scoreboard(game));
        assert.equal(urls.filter(url => url.includes('/injuries')).length, 1);
        assert.equal(urls.filter(url => url.includes('/depthcharts')).length, 2);
        assert.equal(urls.filter(url => url.includes('/leaders?')).length, 0, 'archiving requires no stats calls');
        const current = await service.get('100');
        assert.equal(current.availability.teams[0].quarterbacks.primary.status, 'Out');
        assert.equal(current.availability.teams[0].quarterbacks.replacement.metrics[0].display, '500 YDS, 3 TD');
        assert.equal(current.availability.teams[0].absences[0].id,'3');
        assert.equal(urls.filter(url => url.includes('/injuries')).length, 1, 'modal reuses scoreboard capture');
        assert.equal(JSON.stringify(db.prepare('SELECT * FROM games').all()), beforeGames);

        // Entering the kickoff window shortens freshness even for existing six-hour entries.
        clock = kickoff - 2 * 60 * 60 * 1000;
        const injuryCalls = () => urls.filter(url => url.includes('/injuries')).length;
        const beforeWindow = injuryCalls();
        await service.ingestScoreboard(scoreboard(game));
        assert.equal(injuryCalls(), beforeWindow + 1);
        assert.equal(urls.filter(url=>url.includes('/leaders?')).length,2,'background capture reuses cached stats without new leader requests');
        clock += 10 * 60 * 1000;
        await service.get('100');
        assert.equal(injuryCalls(), beforeWindow + 1, 'kickoff-window report still caches for thirty minutes');

        const metadata = new Database(path.join(dir, 'insights.db'), { readonly: true });
        const archived = metadata.prepare("SELECT data FROM availability WHERE game_id='100' AND team_id='10'").get().data;
        assert.equal(JSON.parse(archived).absences[0].id,'3','nonstarter contributor injuries survive subsequent background captures');
        assert.equal(JSON.parse(archived).quarterbacks.replacement.metrics.length, 0, 'archive keeps availability, not mutable season totals');
        clock = kickoff + 60 * 60 * 1000; out = false;
        const before = urls.length;
        const historical = await service.get('100');
        assert.ok(urls.slice(before).every(url => url.includes('/schedule?')), 'past matchups only refresh result coverage, never current player reports');
        assert.equal(historical.availability.teams[0].quarterbacks.primary.status, 'Out');
        assert.equal(metadata.prepare("SELECT data FROM availability WHERE game_id='100' AND team_id='10'").get().data, archived);

        db.prepare("UPDATE games SET status='final',away_score=10,home_score=21 WHERE id='100'").run();
        const next = { ...game, id: '101', week: 5, game_date: '2026-10-11T17:00:00Z' };
        insert.run(next); clock = Date.parse(next.game_date) - 24 * 60 * 60 * 1000;
        await service.ingestScoreboard(scoreboard(next));
        const nextResult = await service.get('101');
        assert.equal(nextResult.availability.teams[0].quarterbacks.primary.status, null);
        assert.equal(nextResult.recent[0].games[0].quarterback.status, 'Out');
        assert.equal(nextResult.recent[0].games[0].quarterback.replacement, 'Backup QB');
        assert.equal(metadata.prepare("SELECT data FROM availability WHERE game_id='100' AND team_id='10'").get().data, archived);
        const unknown = { ...game, id: '99', week: 3, game_date: '2026-09-27T17:00:00Z', status: 'final', away_score: 3, home_score: 7 };
        insert.run(unknown);
        assert.equal((await service.get('99')).availability.teams[0].missing, true);
        service.close();
        service = createInsights({ db, cacheDir: dir, now: () => clock, fetchJson: async () => { throw new Error('Offline'); } });
        assert.equal((await service.get('100')).availability.teams[0].quarterbacks.primary.status, 'Out');
        metadata.close();
        console.log('availability-history.test.cjs: whole-scoreboard capture, shared requests, immutable pregame snapshots, restart history, unknown coverage, QB result annotations, and read-only games passed');
    } finally {
        service?.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
