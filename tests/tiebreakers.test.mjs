import assert from 'assert/strict';
import {
  breakTieMultiTeam,
  createDivisionTiebreakSort,
  headToHeadRecords,
  divisionRecords,
  conferenceRecords,
  commonGamesRecords,
  teamGames,
  strengthRecords
} from '../public/modules/tiebreakers.js';

function resetMaps() {
  const maps = [
    headToHeadRecords,
    divisionRecords,
    conferenceRecords,
    commonGamesRecords,
    teamGames,
    strengthRecords
  ];
  maps.forEach(map => {
    Object.keys(map).forEach(key => delete map[key]);
  });
}

function setRecords(target, data) {
  Object.keys(data).forEach(key => {
    target[key] = data[key];
  });
}

// Test 1: Wild card multi-team with division re-entry
resetMaps();
const A1 = { abbr: 'A1', division: 'AFC East', conference: 'AFC', wins: 10, losses: 7, winPct: 0.588 };
const A2 = { abbr: 'A2', division: 'AFC East', conference: 'AFC', wins: 10, losses: 7, winPct: 0.588 };
const B1 = { abbr: 'B1', division: 'AFC West', conference: 'AFC', wins: 10, losses: 7, winPct: 0.588 };

setRecords(headToHeadRecords, {
  A1_vs_A2: { wins: 2, losses: 0, ties: 0, winPct: 1 },
  A2_vs_A1: { wins: 0, losses: 2, ties: 0, winPct: 0 }
});

setRecords(conferenceRecords, {
  A1: { wins: 6, losses: 6, ties: 0 },
  A2: { wins: 6, losses: 6, ties: 0 },
  B1: { wins: 8, losses: 4, ties: 0 }
});

const wildcardOrder = breakTieMultiTeam([A1, A2, B1], 'wildcard').map(t => t.abbr);
assert.deepEqual(wildcardOrder, ['B1', 'A1', 'A2']);

// Test 2: Division multi-team resolved by common games
resetMaps();
const D1 = { abbr: 'D1', division: 'NFC North', conference: 'NFC', wins: 9, losses: 8, winPct: 0.529 };
const D2 = { abbr: 'D2', division: 'NFC North', conference: 'NFC', wins: 9, losses: 8, winPct: 0.529 };
const D3 = { abbr: 'D3', division: 'NFC North', conference: 'NFC', wins: 9, losses: 8, winPct: 0.529 };

setRecords(teamGames, {
  D1: [
    { opponent: 'X', result: 'win' },
    { opponent: 'Y', result: 'win' },
    { opponent: 'Z', result: 'win' },
    { opponent: 'W', result: 'loss' }
  ],
  D2: [
    { opponent: 'X', result: 'win' },
    { opponent: 'Y', result: 'win' },
    { opponent: 'Z', result: 'loss' },
    { opponent: 'W', result: 'loss' }
  ],
  D3: [
    { opponent: 'X', result: 'win' },
    { opponent: 'Y', result: 'loss' },
    { opponent: 'Z', result: 'loss' },
    { opponent: 'W', result: 'loss' }
  ]
});

const divisionOrder = breakTieMultiTeam([D1, D2, D3], 'division');
assert.equal(divisionOrder[0].abbr, 'D1');

// Test 3: Strength of victory breaks a two-team tie
resetMaps();
const S1 = { abbr: 'S1', division: 'AFC South', conference: 'AFC', wins: 8, losses: 9, winPct: 0.471 };
const S2 = { abbr: 'S2', division: 'AFC South', conference: 'AFC', wins: 8, losses: 9, winPct: 0.471 };

setRecords(strengthRecords, {
  S1: { sov: 0.55, sos: 0.5 },
  S2: { sov: 0.45, sos: 0.5 }
});

const sortedTwo = [S1, S2].sort(createDivisionTiebreakSort()).map(t => t.abbr);
assert.deepEqual(sortedTwo, ['S1', 'S2']);

console.log('tiebreakers.test.mjs: all tests passed');
