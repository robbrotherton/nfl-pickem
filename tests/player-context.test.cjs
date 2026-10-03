const assert = require('node:assert/strict');
const { buildPlayerContext } = require('../lib/player-context');
const { availabilityTtl } = require('../lib/team-availability');
const HOUR = 60 * 60 * 1000;
const athlete = (id, name, position) => ({ id, displayName: name, position: { abbreviation: position } });
const starter = athlete('1', 'First QB', 'QB'), backup = athlete('2', 'Backup QB', 'QB');
const receiver = athlete('3', 'Starting WR', 'WR'), reserve = athlete('4', 'Reserve WR', 'WR');
const defender = athlete('5', 'Starting defender', 'DE'), reserveDefender = athlete('6', 'Reserve defender', 'DE');
const depth = { depthchart: [{ positions: {
    qb: { position: { abbreviation: 'QB' }, athletes: [starter, backup] },
    wr: { position: { abbreviation: 'WR' }, athletes: [receiver, reserve] },
    de: { position: { abbreviation: 'DE' }, athletes: [defender, reserveDefender] }
} }] };
const leader = (athlete, value, displayValue) => ({ athlete, value, displayValue });
const categories = [
    { name: 'passingLeader', leaders: [leader(backup, 700, '700 YDS, 6 TD'), leader(starter, 200, '200 YDS, 1 TD')] },
    { name: 'quarterbackRating', leaders: [leader(backup, 110, '110.0'), leader(starter, 90, '90.0')] },
    { name: 'receivingLeader', leaders: [leader(reserve, 250, '250 YDS'), leader(receiver, 150, '150 YDS')] },
    { name: 'sacks', leaders: [leader(reserveDefender, 5, '5'), leader(defender, 3, '3')] }
];
function context(injuryRows = [], overrides = {}) {
    return buildPlayerContext({ depth, categories, injuryRows, reportAvailable: true, ...overrides });
}
const returned = context();
assert.equal(returned.quarterbacks.primary.id, '1');
assert.equal(returned.quarterbacks.primary.metrics[0].display, '200 YDS, 1 TD');
assert.equal(returned.quarterbacks.primary.metrics[1].display, '90.0');
assert.equal(returned.quarterbacks.replacement, null);
assert.deepEqual(returned.highlights.map(player => player.id), ['3', '5']);
assert.ok(!returned.highlights.some(player => player.id === '2'));
const reserveOut = context([{ athlete: backup, status: 'Out' }], { roles: new Map([['2', 'Saved team contributor']]) });
assert.equal(reserveOut.absences.length, 0, 'a backup passing leader is not a key starter absence');
assert.equal(reserveOut.injuries.length, 1, 'backup injuries remain in the full report');

const absent = context([{ athlete: starter, status: 'Out', details: { type: 'Hamstring' } }]);
assert.equal(absent.quarterbacks.primary.status, 'Out');
assert.equal(absent.quarterbacks.replacement.id, '2');
assert.equal(absent.quarterbacks.replacement.metrics[0].display, '700 YDS, 6 TD');
assert.match(absent.quarterbacks.note, /not confirmed/);
assert.ok(!absent.absences.some(player => player.id === '1'), 'QB injury appears once in the main card');
assert.ok(absent.injuries.some(player => player.id === '1'), 'full report retains the QB');
const promoted = JSON.parse(JSON.stringify(depth));
promoted.depthchart[0].positions.qb.athletes = [backup, starter];
const changedChart = context([{ athlete: starter, status: 'Out' }], { depth: promoted, previousQuarterback: returned.quarterbacks.primary });
assert.equal(changedChart.quarterbacks.primary.id, '1');
assert.equal(changedChart.quarterbacks.primary.label, 'Previously listed QB1');
assert.equal(changedChart.quarterbacks.replacement.id, '2');
assert.equal(context([], { depth: promoted, previousQuarterback: returned.quarterbacks.primary }).quarterbacks.primary.id, '2', 'a prior starter is not assumed injured');

const questionable = context([{ athlete: starter, status: 'Questionable' }]);
assert.equal(questionable.quarterbacks.replacement, null);
assert.match(questionable.quarterbacks.note, /does not confirm/);
const inactive = context([{ athlete: receiver, status: 'Out' }, { athlete: defender, status: 'Doubtful' }]);
assert.equal(inactive.highlights.length, 0);
assert.deepEqual(inactive.absences.map(player => player.id), ['3', '5']);
const missing = context([], { depth: null, reportAvailable: false });
assert.equal(missing.quarterbacks.primary, null);
assert.equal(missing.highlights.length, 0);
assert.equal(context([], { reportAvailable: false }).quarterbacks.primary.availability, 'Injury status unavailable');
const embedded = JSON.parse(JSON.stringify(depth));
embedded.depthchart[0].positions.qb.athletes[0].injuries = [{ status: 'Out' }];
assert.equal(context([], { depth: embedded }).quarterbacks.replacement.id, '2');
assert.equal(context([{ athlete: starter, status: 'Active' }], { depth: embedded }).quarterbacks.replacement, null);
assert.equal(context([{ athlete: starter, type: { description: 'Out' } }]).quarterbacks.replacement.id, '2');

const kickoff = Date.parse('2026-10-04T17:00:00Z');
assert.equal(availabilityTtl('2026-10-04T17:00:00Z', kickoff - 24 * HOUR), 6 * HOUR);
assert.equal(availabilityTtl('2026-10-04T17:00:00Z', kickoff - 6 * HOUR), HOUR / 2);
assert.equal(availabilityTtl('2026-10-04T17:00:00Z', kickoff - HOUR), HOUR / 2);
console.log('player-context.test.cjs: QB role changes, replacements, all-QB stats, starter-only highlights, status uncertainty, and adaptive TTLs passed');
