// simulation.js
// Monte Carlo simulation and scenario analysis
// 
// Note: Simulations rebuild tiebreaker data from simulated outcomes (head-to-head, conference records, etc.).
// Some lower-priority NFL tiebreakers (point differential, etc.) are still not implemented.

import { MONTE_CARLO_ITERATIONS, HOME_FIELD_ADVANTAGE } from './constants.js';
import {
    getTargetTeam,
    getAllStandings,
    getAllGames,
    getCriticalGames,
    getUserOutcomes,
    isUsingWeightedSimulation
} from './state.js';
import { calculatePlayoffTeams } from './playoff-calculator.js';
import { 
    createDivisionTiebreakSort, 
    createWildCardTiebreakSort,
    buildTiebreakRecordsFromGames,
    snapshotTiebreakRecords,
    setTiebreakRecords
} from './tiebreakers.js';

// ========================================
// GAME OUTCOME PREDICTION
// ========================================

/**
 * Get predicted outcome for a game based on simulation mode
 */
export function getGameOutcome(game, standingsByAbbr) {
    const allStandings = getAllStandings();
    const standingsIndex = standingsByAbbr || buildStandingsIndex(allStandings);
    
    // Determine outcome based on simulation mode
    if (isUsingWeightedSimulation()) {
        // Weighted by win percentage
        const homeTeam = standingsIndex.get(game.homeTeam.abbr);
        const awayTeam = standingsIndex.get(game.awayTeam.abbr);
        
        if (!homeTeam || !awayTeam) {
            return Math.random() < 0.5 ? 'home' : 'away';
        }
        
        const homeWinPct = homeTeam.winPct || 0.5;
        const awayWinPct = awayTeam.winPct || 0.5;
        
        // Simple weighted probability: home team gets their win% vs away team's win%
        // Also add slight home field advantage (about 55% for equal teams)
        const totalWeight = homeWinPct + awayWinPct;
        let homeProb = totalWeight > 0 ? (homeWinPct / totalWeight) + HOME_FIELD_ADVANTAGE : 0.5 + HOME_FIELD_ADVANTAGE;
        if (homeProb > 1) homeProb = 1;
        if (homeProb < 0) homeProb = 0;
        
        return Math.random() < homeProb ? 'home' : 'away';
    } else {
        // Random 50/50
        return Math.random() < 0.5 ? 'home' : 'away';
    }
}

// ========================================
// SCENARIO SIMULATION
// ========================================

/**
 * Simulate a scenario with given game outcomes
 * Returns playoff results for target team
 */
export function simulateScenario(outcomes, options = {}) {
    const allStandings = getAllStandings();
    const allGames = options.allGames || getAllGames();
    const remainingGames = options.remainingGames || getRemainingGames(allGames);
    const targetAbbr = getTargetTeam();
    const standingsIndex = options.standingsIndex || buildStandingsIndex(allStandings);

    const resolvedOutcomes = ensureOutcomesForRemainingGames(outcomes, remainingGames, standingsIndex);
    const simulatedGames = buildSimulatedGames(allGames, resolvedOutcomes);
    const standings = buildStandingsFromSimulatedGames(allStandings, simulatedGames);
    
    // Get target team's conference
    const targetTeam = standings.find(t => t.abbr === targetAbbr);
    const targetConference = targetTeam?.conference || 'NFC';

    const tiebreakSnapshot = snapshotTiebreakRecords();
    setTiebreakRecords(buildTiebreakRecordsFromGames(simulatedGames));

    // Filter to conference standings and calculate playoff teams
    const conferenceStandings = standings.filter(t => t.conference === targetConference);
    const playoffTeams = calculatePlayoffTeams(conferenceStandings);
    
    // Check if target team made it
    const targetMadePlayoffs = playoffTeams.some(t => t.abbr === targetAbbr);
    const targetSeed = playoffTeams.find(t => t.abbr === targetAbbr)?.seed || null;
    
    // Calculate target team's position in division (using tiebreaker sort)
    const targetTeamData = conferenceStandings.find(t => t.abbr === targetAbbr);
    const divisionTeams = standings.filter(t => t.division === targetTeamData.division)
        .sort(createDivisionTiebreakSort());
    const targetDivisionRank = divisionTeams.findIndex(t => t.abbr === targetAbbr) + 1;
    
    // Calculate target team's position in wildcard race (among non-division winners)
    const divisionWinners = playoffTeams.filter(t => t.seed <= 4);
    const wildCardPool = conferenceStandings.filter(team => 
        !divisionWinners.find(dw => dw.id === team.id)
    ).sort(createWildCardTiebreakSort());
    const targetWildcardRank = wildCardPool.findIndex(t => t.abbr === targetAbbr) + 1;

    setTiebreakRecords(tiebreakSnapshot);
    
    return {
        standings,
        playoffTeams,
        targetMadePlayoffs,
        targetSeed,
        targetDivisionRank,
        targetWildcardRank
    };
}

// ========================================
// MONTE CARLO SIMULATION
// ========================================

/**
 * Run Monte Carlo simulation to calculate playoff probabilities
 */
export function runMonteCarloSimulation() {
    const userOutcomes = getUserOutcomes();
    const allStandings = getAllStandings();
    const allGames = getAllGames();
    const remainingGames = getRemainingGames(allGames);
    const standingsIndex = buildStandingsIndex(allStandings);
    
    let targetPlayoffCount = 0;
    const seedCounts = {};
    let bestResult = null;
    let worstResult = null;
    
    for (let i = 0; i < MONTE_CARLO_ITERATIONS; i++) {
        // Generate random outcomes for undecided games
        const outcomes = { ...userOutcomes };
        
        remainingGames.forEach(game => {
            if (!outcomes[game.id]) {
                outcomes[game.id] = getGameOutcome(game, standingsIndex);
            }
        });
        
        const result = simulateScenario(outcomes, { allGames, remainingGames, standingsIndex });
        
        if (result.targetMadePlayoffs) {
            targetPlayoffCount++;
            seedCounts[result.targetSeed] = (seedCounts[result.targetSeed] || 0) + 1;
        }

        if (isBetterBestCase(result, bestResult)) {
            bestResult = result;
        }
        if (isWorseCase(result, worstResult)) {
            worstResult = result;
        }
    }
    
    const playoffProbability = (targetPlayoffCount / MONTE_CARLO_ITERATIONS) * 100;
    
    return {
        playoffProbability,
        targetPlayoffCount,
        totalIterations: MONTE_CARLO_ITERATIONS,
        seedCounts,
        bestResult,
        worstResult
    };
}

// ========================================
// BEST/WORST CASE SCENARIOS
// ========================================

/**
 * Find the best possible scenario for target team
 */
export function findBestCaseScenario() {
    const userOutcomes = getUserOutcomes();
    const allGames = getAllGames();
    const remainingGames = getRemainingGames(allGames);
    
    // Get all undecided games (not locked by user)
    const undecidedGames = remainingGames.filter(g => !userOutcomes[g.id]);
    
    // Use brute force only for very small scenarios
    const maxBruteForce = 12; // 2^12 = 4096 combinations
    
    if (undecidedGames.length <= maxBruteForce) {
        return findBestCaseBruteForce(undecidedGames);
    }
    return findBestCaseBranchAndBound(remainingGames, userOutcomes);
}

/**
 * Brute force search for best case (small number of games)
 */
function findBestCaseBruteForce(undecidedGames) {
    const userOutcomes = getUserOutcomes();
    const criticalGames = getCriticalGames();
    
    let bestResult = null;
    let bestOutcomes = null;
    const numCombinations = Math.pow(2, undecidedGames.length);
    
    for (let i = 0; i < numCombinations; i++) {
        const outcomes = { ...userOutcomes };
        
        undecidedGames.forEach((game, index) => {
            const bit = (i >> index) & 1;
            outcomes[game.id] = bit === 0 ? 'home' : 'away';
        });
        
        const result = simulateScenario(outcomes);
        
        if (!bestResult || 
            (result.targetMadePlayoffs && !bestResult.targetMadePlayoffs) ||
            (result.targetMadePlayoffs && bestResult.targetMadePlayoffs && result.targetSeed < bestResult.targetSeed) ||
            (!result.targetMadePlayoffs && !bestResult.targetMadePlayoffs && 
             (result.targetWildcardRank < bestResult.targetWildcardRank || result.targetDivisionRank < bestResult.targetDivisionRank))) {
            bestResult = result;
            bestOutcomes = outcomes;
        }
    }
    
    return {
        outcomes: bestOutcomes,
        result: bestResult,
        gamesSet: criticalGames.filter(g => bestOutcomes[g.id]).map(g => ({
            ...g,
            selectedWinner: bestOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
        }))
    };
}

/**
 * Heuristic search for best case (large number of games)
 */
function findBestCaseHeuristic(undecidedGames) {
    const allStandings = getAllStandings();
    const userOutcomes = getUserOutcomes();
    const criticalGames = getCriticalGames();
    const targetAbbr = getTargetTeam();
    
    const targetGames = undecidedGames.filter(g => 
        g.homeTeam.abbr === targetAbbr || g.awayTeam.abbr === targetAbbr
    );
    
    // Get division rivals (other teams in same division)
    const targetTeam = allStandings.find(t => t.abbr === targetAbbr);
    const targetDivision = targetTeam?.division || 'NFC North';
    const divisionRivals = allStandings
        .filter(t => t.division === targetDivision && t.abbr !== targetAbbr)
        .map(t => t.abbr);
    
    const otherGames = undecidedGames.filter(g => 
        g.homeTeam.abbr !== targetAbbr && g.awayTeam.abbr !== targetAbbr
    );
    
    let bestResult = null;
    let bestOutcomes = null;
    
    // Strategy 1: Target team wins all, rivals lose all, others random (3000 samples)
    for (let i = 0; i < 3000; i++) {
        const outcomes = { ...userOutcomes };
        
        targetGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === targetAbbr ? 'home' : 'away';
        });
        
        otherGames.forEach(game => {
            if (divisionRivals.includes(game.homeTeam.abbr)) {
                outcomes[game.id] = 'away';
            } else if (divisionRivals.includes(game.awayTeam.abbr)) {
                outcomes[game.id] = 'home';
            } else {
                outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
            }
        });
        
        const result = simulateScenario(outcomes);
        
        if (!bestResult || 
            (result.targetMadePlayoffs && !bestResult.targetMadePlayoffs) ||
            (result.targetMadePlayoffs && bestResult.targetMadePlayoffs && result.targetSeed < bestResult.targetSeed) ||
            (!result.targetMadePlayoffs && !bestResult.targetMadePlayoffs && 
             (result.targetWildcardRank < bestResult.targetWildcardRank || result.targetDivisionRank < bestResult.targetDivisionRank))) {
            bestResult = result;
            bestOutcomes = outcomes;
        }
    }
    
    // Strategy 2: All non-target games favor higher seeds losing (helps wildcard chances)
    for (let i = 0; i < 1000; i++) {
        const outcomes = { ...userOutcomes };
        
        targetGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === targetAbbr ? 'home' : 'away';
        });
        
        otherGames.forEach(game => {
            // Favor upsets - helps target wildcard chances
            outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
        });
        
        const result = simulateScenario(outcomes);
        
        if (!bestResult || 
            (result.targetMadePlayoffs && !bestResult.targetMadePlayoffs) ||
            (result.targetMadePlayoffs && bestResult.targetMadePlayoffs && result.targetSeed < bestResult.targetSeed) ||
            (!result.targetMadePlayoffs && !bestResult.targetMadePlayoffs && 
             (result.targetWildcardRank < bestResult.targetWildcardRank || result.targetDivisionRank < bestResult.targetDivisionRank))) {
            bestResult = result;
            bestOutcomes = outcomes;
        }
    }
    
    return {
        outcomes: bestOutcomes,
        result: bestResult,
        gamesSet: criticalGames.filter(g => bestOutcomes[g.id]).map(g => ({
            ...g,
            selectedWinner: bestOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
        }))
    };
}

/**
 * Find the worst possible scenario for target team
 */
export function findWorstCaseScenario() {
    const userOutcomes = getUserOutcomes();
    const allGames = getAllGames();
    const remainingGames = getRemainingGames(allGames);
    
    // Get all undecided games (not locked by user)
    const undecidedGames = remainingGames.filter(g => !userOutcomes[g.id]);
    
    const maxBruteForce = 12; // 2^12 = 4096 combinations
    
    if (undecidedGames.length <= maxBruteForce) {
        return findWorstCaseBruteForce(undecidedGames);
    }
    return findWorstCaseBranchAndBound(remainingGames, userOutcomes);
}

/**
 * Brute force search for worst case (small number of games)
 */
function findWorstCaseBruteForce(undecidedGames) {
    const userOutcomes = getUserOutcomes();
    const criticalGames = getCriticalGames();
    
    let worstResult = null;
    let worstOutcomes = null;
    const numCombinations = Math.pow(2, undecidedGames.length);
    
    for (let i = 0; i < numCombinations; i++) {
        const outcomes = { ...userOutcomes };
        
        undecidedGames.forEach((game, index) => {
            const bit = (i >> index) & 1;
            outcomes[game.id] = bit === 0 ? 'home' : 'away';
        });
        
        const result = simulateScenario(outcomes);
        
        if (!worstResult || 
            (!result.targetMadePlayoffs && worstResult.targetMadePlayoffs) ||
            (result.targetMadePlayoffs && worstResult.targetMadePlayoffs && result.targetSeed > worstResult.targetSeed) ||
            (!result.targetMadePlayoffs && !worstResult.targetMadePlayoffs && 
             (result.targetWildcardRank > worstResult.targetWildcardRank || result.targetDivisionRank > worstResult.targetDivisionRank))) {
            worstResult = result;
            worstOutcomes = outcomes;
        }
    }
    
    return {
        outcomes: worstOutcomes,
        result: worstResult,
        gamesSet: criticalGames.filter(g => worstOutcomes[g.id]).map(g => ({
            ...g,
            selectedWinner: worstOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
        }))
    };
}

/**
 * Heuristic search for worst case (large number of games)
 */
function findWorstCaseHeuristic(undecidedGames) {
    const allStandings = getAllStandings();
    const userOutcomes = getUserOutcomes();
    const criticalGames = getCriticalGames();
    const targetAbbr = getTargetTeam();
    
    const targetGames = undecidedGames.filter(g => 
        g.homeTeam.abbr === targetAbbr || g.awayTeam.abbr === targetAbbr
    );
    
    // Get division rivals (other teams in same division)
    const targetTeam = allStandings.find(t => t.abbr === targetAbbr);
    const targetDivision = targetTeam?.division || 'NFC North';
    const divisionRivals = allStandings
        .filter(t => t.division === targetDivision && t.abbr !== targetAbbr)
        .map(t => t.abbr);
    
    const otherGames = undecidedGames.filter(g => 
        g.homeTeam.abbr !== targetAbbr && g.awayTeam.abbr !== targetAbbr
    );
    
    let worstResult = null;
    let worstOutcomes = null;
    
    // Strategy 1: Target team loses all, rivals win all, others random (3000 samples)
    for (let i = 0; i < 3000; i++) {
        const outcomes = { ...userOutcomes };
        
        targetGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === targetAbbr ? 'away' : 'home';
        });
        
        otherGames.forEach(game => {
            if (divisionRivals.includes(game.homeTeam.abbr)) {
                outcomes[game.id] = 'home';
            } else if (divisionRivals.includes(game.awayTeam.abbr)) {
                outcomes[game.id] = 'away';
            } else {
                outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
            }
        });
        
        const result = simulateScenario(outcomes);
        
        if (!worstResult || 
            (!result.targetMadePlayoffs && worstResult.targetMadePlayoffs) ||
            (result.targetMadePlayoffs && worstResult.targetMadePlayoffs && result.targetSeed > worstResult.targetSeed) ||
            (!result.targetMadePlayoffs && !worstResult.targetMadePlayoffs && 
             (result.targetWildcardRank > worstResult.targetWildcardRank || result.targetDivisionRank > worstResult.targetDivisionRank))) {
            worstResult = result;
            worstOutcomes = outcomes;
        }
    }
    
    // Strategy 2: All non-target games go chalk (favorites/better records win)
    for (let i = 0; i < 1000; i++) {
        const outcomes = { ...userOutcomes };
        
        targetGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === targetAbbr ? 'away' : 'home';
        });
        
        otherGames.forEach(game => {
            outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
        });
        
        const result = simulateScenario(outcomes);
        
        if (!worstResult || 
            (!result.targetMadePlayoffs && worstResult.targetMadePlayoffs) ||
            (result.targetMadePlayoffs && worstResult.targetMadePlayoffs && result.targetSeed > worstResult.targetSeed) ||
            (!result.targetMadePlayoffs && !worstResult.targetMadePlayoffs && 
             (result.targetWildcardRank > worstResult.targetWildcardRank || result.targetDivisionRank > worstResult.targetDivisionRank))) {
            worstResult = result;
            worstOutcomes = outcomes;
        }
    }
    
    return {
        outcomes: worstOutcomes,
        result: worstResult,
        gamesSet: criticalGames.filter(g => worstOutcomes[g.id]).map(g => ({
            ...g,
            selectedWinner: worstOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
        }))
    };
}

function findBestCaseBranchAndBound(remainingGames, userOutcomes) {
    const allGames = getAllGames();
    const allStandings = getAllStandings();
    const { undecidedGames, wins, remainingCounts, targetIdx, conferenceIdxs } =
        initializeBranchAndBoundState(remainingGames, userOutcomes, allStandings);

    if (!undecidedGames.length) {
        const result = simulateScenario({ ...userOutcomes }, { allGames, remainingGames });
        return {
            outcomes: { ...userOutcomes },
            result,
            gamesSet: getCriticalGames().filter(g => userOutcomes[g.id]).map(g => ({
                ...g,
                selectedWinner: userOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
            }))
        };
    }

    const orderedGames = orderGamesForTarget(undecidedGames, targetIdx, 'best');
    const outcomes = { ...userOutcomes };
    let bestResult = null;
    let bestOutcomes = null;
    let stop = false;

    const dfs = (idx) => {
        if (stop) return;
        if (!canStillMakePlayoffs(wins, remainingCounts, targetIdx, conferenceIdxs)) {
            return;
        }
        if (idx === orderedGames.length) {
            const result = simulateScenario(outcomes, { allGames, remainingGames });
            if (isBetterBestCase(result, bestResult)) {
                bestResult = result;
                bestOutcomes = { ...outcomes };
                if (bestResult.targetMadePlayoffs && bestResult.targetSeed === 1) {
                    stop = true;
                }
            }
            return;
        }

        const game = orderedGames[idx];
        const outcomeOrder = getOutcomeOrder(game, targetIdx, 'best');
        outcomeOrder.forEach(outcome => {
            outcomes[game.id] = outcome;
            if (outcome === 'home') wins[game.homeIdx] += 1;
            if (outcome === 'away') wins[game.awayIdx] += 1;
            remainingCounts[game.homeIdx] -= 1;
            remainingCounts[game.awayIdx] -= 1;

            dfs(idx + 1);

            remainingCounts[game.homeIdx] += 1;
            remainingCounts[game.awayIdx] += 1;
            if (outcome === 'home') wins[game.homeIdx] -= 1;
            if (outcome === 'away') wins[game.awayIdx] -= 1;
            delete outcomes[game.id];
        });
    };

    dfs(0);

    const result = bestResult || simulateScenario(outcomes, { allGames, remainingGames });
    const finalOutcomes = bestOutcomes || { ...outcomes };
    const criticalGames = getCriticalGames();
    return {
        outcomes: finalOutcomes,
        result,
        gamesSet: criticalGames.filter(g => finalOutcomes[g.id]).map(g => ({
            ...g,
            selectedWinner: finalOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
        }))
    };
}

function findWorstCaseBranchAndBound(remainingGames, userOutcomes) {
    const allGames = getAllGames();
    const allStandings = getAllStandings();
    const { undecidedGames, wins, remainingCounts, targetIdx, conferenceIdxs } =
        initializeBranchAndBoundState(remainingGames, userOutcomes, allStandings);

    if (!undecidedGames.length) {
        const result = simulateScenario({ ...userOutcomes }, { allGames, remainingGames });
        return {
            outcomes: { ...userOutcomes },
            result,
            gamesSet: getCriticalGames().filter(g => userOutcomes[g.id]).map(g => ({
                ...g,
                selectedWinner: userOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
            }))
        };
    }

    const orderedGames = orderGamesForTarget(undecidedGames, targetIdx, 'worst');
    const outcomes = { ...userOutcomes };
    let worstResult = null;
    let worstOutcomes = null;

    const dfs = (idx) => {
        if (isGuaranteedPlayoffs(wins, remainingCounts, targetIdx, conferenceIdxs)) {
            return;
        }
        if (idx === orderedGames.length) {
            const result = simulateScenario(outcomes, { allGames, remainingGames });
            if (isWorseCase(result, worstResult)) {
                worstResult = result;
                worstOutcomes = { ...outcomes };
            }
            return;
        }

        const game = orderedGames[idx];
        const outcomeOrder = getOutcomeOrder(game, targetIdx, 'worst');
        outcomeOrder.forEach(outcome => {
            outcomes[game.id] = outcome;
            if (outcome === 'home') wins[game.homeIdx] += 1;
            if (outcome === 'away') wins[game.awayIdx] += 1;
            remainingCounts[game.homeIdx] -= 1;
            remainingCounts[game.awayIdx] -= 1;

            dfs(idx + 1);

            remainingCounts[game.homeIdx] += 1;
            remainingCounts[game.awayIdx] += 1;
            if (outcome === 'home') wins[game.homeIdx] -= 1;
            if (outcome === 'away') wins[game.awayIdx] -= 1;
            delete outcomes[game.id];
        });
    };

    dfs(0);

    const result = worstResult || simulateScenario(outcomes, { allGames, remainingGames });
    const finalOutcomes = worstOutcomes || { ...outcomes };
    const criticalGames = getCriticalGames();
    return {
        outcomes: finalOutcomes,
        result,
        gamesSet: criticalGames.filter(g => finalOutcomes[g.id]).map(g => ({
            ...g,
            selectedWinner: finalOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
        }))
    };
}

function initializeBranchAndBoundState(remainingGames, userOutcomes, allStandings) {
    const teams = Array.isArray(allStandings) ? allStandings : [];
    const indexByAbbr = new Map();
    const wins = [];
    const remainingCounts = [];
    const conferenceIdxs = [];
    let targetIdx = null;

    teams.forEach((team, idx) => {
        indexByAbbr.set(team.abbr, idx);
        wins[idx] = team.wins || 0;
        remainingCounts[idx] = 0;
    });

    const targetAbbr = getTargetTeam();
    const targetConference = teams.find(team => team.abbr === targetAbbr)?.conference || 'NFC';
    teams.forEach((team, idx) => {
        if (team.conference === targetConference) {
            conferenceIdxs.push(idx);
        }
        if (team.abbr === targetAbbr) targetIdx = idx;
    });

    const undecidedGames = [];
    remainingGames.forEach(game => {
        const homeIdx = indexByAbbr.get(game.homeTeam?.abbr);
        const awayIdx = indexByAbbr.get(game.awayTeam?.abbr);
        if (homeIdx === undefined || awayIdx === undefined) return;

        const outcome = userOutcomes[game.id];
        if (outcome) {
            if (outcome === 'home') wins[homeIdx] += 1;
            if (outcome === 'away') wins[awayIdx] += 1;
        } else {
            remainingCounts[homeIdx] += 1;
            remainingCounts[awayIdx] += 1;
            undecidedGames.push({
                ...game,
                homeIdx,
                awayIdx
            });
        }
    });

    if (targetIdx === null) {
        targetIdx = indexByAbbr.get(getTargetTeam());
    }

    return {
        undecidedGames,
        wins,
        remainingCounts,
        targetIdx,
        conferenceIdxs
    };
}

function orderGamesForTarget(games, targetIdx, mode) {
    if (!Array.isArray(games) || targetIdx === null || targetIdx === undefined) return games || [];
    return [...games].sort((a, b) => {
        const aTarget = a.homeIdx === targetIdx || a.awayIdx === targetIdx;
        const bTarget = b.homeIdx === targetIdx || b.awayIdx === targetIdx;
        if (aTarget !== bTarget) return aTarget ? -1 : 1;
        if (mode === 'best') return (a.week || 0) - (b.week || 0);
        return (b.week || 0) - (a.week || 0);
    });
}

function getOutcomeOrder(game, targetIdx, mode) {
    const homeIsTarget = game.homeIdx === targetIdx;
    const awayIsTarget = game.awayIdx === targetIdx;
    if (homeIsTarget || awayIsTarget) {
        const targetOutcome = homeIsTarget ? 'home' : 'away';
        const otherOutcome = homeIsTarget ? 'away' : 'home';
        return mode === 'best' ? [targetOutcome, otherOutcome] : [otherOutcome, targetOutcome];
    }
    return mode === 'best' ? ['home', 'away'] : ['away', 'home'];
}

function canStillMakePlayoffs(wins, remainingCounts, targetIdx, conferenceIdxs) {
    if (targetIdx === null || targetIdx === undefined) return true;
    const targetMaxWins = wins[targetIdx] + remainingCounts[targetIdx];
    let betterCount = 0;
    conferenceIdxs.forEach(idx => {
        if (idx === targetIdx) return;
        if (wins[idx] > targetMaxWins) betterCount += 1;
    });
    return betterCount < 7;
}

function isGuaranteedPlayoffs(wins, remainingCounts, targetIdx, conferenceIdxs) {
    if (targetIdx === null || targetIdx === undefined) return false;
    const targetMinWins = wins[targetIdx];
    let possibleAheadOrTie = 0;
    conferenceIdxs.forEach(idx => {
        if (idx === targetIdx) return;
        const maxWins = wins[idx] + remainingCounts[idx];
        if (maxWins >= targetMinWins) possibleAheadOrTie += 1;
    });
    return possibleAheadOrTie <= 6;
}

function isBetterBestCase(result, bestResult) {
    if (!bestResult) return true;
    if (result.targetMadePlayoffs && !bestResult.targetMadePlayoffs) return true;
    if (result.targetMadePlayoffs && bestResult.targetMadePlayoffs) {
        return result.targetSeed < bestResult.targetSeed;
    }
    if (!result.targetMadePlayoffs && !bestResult.targetMadePlayoffs) {
        return result.targetWildcardRank < bestResult.targetWildcardRank ||
            result.targetDivisionRank < bestResult.targetDivisionRank;
    }
    return false;
}

function isWorseCase(result, worstResult) {
    if (!worstResult) return true;
    if (!result.targetMadePlayoffs && worstResult.targetMadePlayoffs) return true;
    if (result.targetMadePlayoffs && worstResult.targetMadePlayoffs) {
        return result.targetSeed > worstResult.targetSeed;
    }
    if (!result.targetMadePlayoffs && !worstResult.targetMadePlayoffs) {
        return result.targetWildcardRank > worstResult.targetWildcardRank ||
            result.targetDivisionRank > worstResult.targetDivisionRank;
    }
    return false;
}

function getRemainingGames(allGames) {
    if (!Array.isArray(allGames)) return [];
    return allGames.filter(game => game.status !== 'final');
}

function buildStandingsIndex(standings) {
    const map = new Map();
    if (!Array.isArray(standings)) return map;
    standings.forEach(team => {
        map.set(team.abbr, team);
    });
    return map;
}

function ensureOutcomesForRemainingGames(outcomes, remainingGames, standingsIndex) {
    const resolved = { ...outcomes };
    remainingGames.forEach(game => {
        if (!resolved[game.id]) {
            resolved[game.id] = getGameOutcome(game, standingsIndex);
        }
    });
    return resolved;
}

function buildSimulatedGames(allGames, outcomes) {
    if (!Array.isArray(allGames)) return [];
    return allGames.map(game => {
        if (game.status === 'final') {
            return {
                home_abbr: game.homeTeam?.abbr,
                away_abbr: game.awayTeam?.abbr,
                home_score: Number.isFinite(game.home_score) ? game.home_score : null,
                away_score: Number.isFinite(game.away_score) ? game.away_score : null
            };
        }
        return {
            home_abbr: game.homeTeam?.abbr,
            away_abbr: game.awayTeam?.abbr,
            result: outcomes[game.id]
        };
    });
}

function buildStandingsFromSimulatedGames(baseStandings, games) {
    const map = new Map();
    (baseStandings || []).forEach(team => {
        map.set(team.abbr, {
            ...team,
            wins: 0,
            losses: 0,
            ties: 0,
            winPct: 0,
            tiebreakReason: null
        });
    });

    games.forEach(game => {
        const home = game.home_abbr;
        const away = game.away_abbr;
        if (!home || !away) return;
        const homeTeam = map.get(home);
        const awayTeam = map.get(away);
        if (!homeTeam || !awayTeam) return;

        const result = resolveGameResult(game);
        if (!result) return;

        if (result === 'home') {
            homeTeam.wins += 1;
            awayTeam.losses += 1;
        } else if (result === 'away') {
            awayTeam.wins += 1;
            homeTeam.losses += 1;
        } else {
            awayTeam.ties += 1;
            homeTeam.ties += 1;
        }
    });

    map.forEach(team => {
        const total = team.wins + team.losses + team.ties;
        team.winPct = total > 0 ? (team.wins + 0.5 * team.ties) / total : 0;
    });

    return Array.from(map.values());
}

function resolveGameResult(game) {
    if (game.result === 'home' || game.result === 'away' || game.result === 'tie') {
        return game.result;
    }
    const homeScore = Number.isFinite(game.home_score) ? game.home_score : null;
    const awayScore = Number.isFinite(game.away_score) ? game.away_score : null;
    if (homeScore === null || awayScore === null) return null;
    if (homeScore > awayScore) return 'home';
    if (awayScore > homeScore) return 'away';
    return 'tie';
}
