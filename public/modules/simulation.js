// simulation.js
// Monte Carlo simulation and scenario analysis

import { MONTE_CARLO_ITERATIONS, HOME_FIELD_ADVANTAGE } from './constants.js';
import {
    getTargetTeam,
    getAllStandings,
    getCriticalGames,
    getUserOutcomes,
    isUsingWeightedSimulation,
    getTargetTeamData
} from './state.js';
import { calculatePlayoffTeams } from './playoff-calculator.js';

// ========================================
// GAME OUTCOME PREDICTION
// ========================================

/**
 * Get predicted outcome for a game based on simulation mode
 */
export function getGameOutcome(game) {
    const allStandings = getAllStandings();
    
    // Determine outcome based on simulation mode
    if (isUsingWeightedSimulation()) {
        // Weighted by win percentage
        const homeTeam = allStandings.find(t => t.abbr === game.homeTeam.abbr);
        const awayTeam = allStandings.find(t => t.abbr === game.awayTeam.abbr);
        
        if (!homeTeam || !awayTeam) {
            return Math.random() < 0.5 ? 'home' : 'away';
        }
        
        const homeWinPct = homeTeam.winPct || 0.5;
        const awayWinPct = awayTeam.winPct || 0.5;
        
        // Simple weighted probability: home team gets their win% vs away team's win%
        // Also add slight home field advantage (about 55% for equal teams)
        const totalWeight = homeWinPct + awayWinPct;
        const homeProb = totalWeight > 0 ? (homeWinPct / totalWeight) + HOME_FIELD_ADVANTAGE : 0.5 + HOME_FIELD_ADVANTAGE;
        
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
export function simulateScenario(outcomes) {
    const allStandings = getAllStandings();
    const criticalGames = getCriticalGames();
    const targetAbbr = getTargetTeam();
    
    // Clone current standings
    const standings = JSON.parse(JSON.stringify(allStandings));
    
    // Get target team's conference
    const targetTeam = standings.find(t => t.abbr === targetAbbr);
    const targetConference = targetTeam?.conference || 'NFC';
    
    // Apply outcomes to update records
    criticalGames.forEach(game => {
        const outcome = outcomes[game.id];
        if (outcome) {
            const winner = outcome === 'home' ? game.homeTeam.abbr : game.awayTeam.abbr;
            const loser = outcome === 'home' ? game.awayTeam.abbr : game.homeTeam.abbr;
            
            const winnerTeam = standings.find(t => t.abbr === winner);
            const loserTeam = standings.find(t => t.abbr === loser);
            
            if (winnerTeam) {
                winnerTeam.wins++;
                winnerTeam.winPct = (winnerTeam.wins + 0.5 * winnerTeam.ties) / (winnerTeam.wins + winnerTeam.losses + winnerTeam.ties);
            }
            if (loserTeam) {
                loserTeam.losses++;
                loserTeam.winPct = (loserTeam.wins + 0.5 * loserTeam.ties) / (loserTeam.wins + loserTeam.losses + loserTeam.ties);
            }
        }
    });
    
    // Filter to conference standings and calculate playoff teams
    const conferenceStandings = standings.filter(t => t.conference === targetConference);
    const playoffTeams = calculatePlayoffTeams(conferenceStandings);
    
    // Check if target team made it
    const targetMadePlayoffs = playoffTeams.some(t => t.abbr === targetAbbr);
    const targetSeed = playoffTeams.find(t => t.abbr === targetAbbr)?.seed || null;
    
    // Calculate target team's position in division
    const targetTeamData = conferenceStandings.find(t => t.abbr === targetAbbr);
    const divisionTeams = standings.filter(t => t.division === targetTeamData.division)
        .sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (a.losses !== b.losses) return a.losses - b.losses;
            return 0;
        });
    const targetDivisionRank = divisionTeams.findIndex(t => t.abbr === targetAbbr) + 1;
    
    // Calculate target team's position in wildcard race (among non-division winners)
    const divisionWinners = playoffTeams.filter(t => t.seed <= 4);
    const wildCardPool = conferenceStandings.filter(team => 
        !divisionWinners.find(dw => dw.id === team.id)
    ).sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return 0;
    });
    const targetWildcardRank = wildCardPool.findIndex(t => t.abbr === targetAbbr) + 1;
    
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
    const criticalGames = getCriticalGames();
    const userOutcomes = getUserOutcomes();
    const targetAbbr = getTargetTeam();
    
    let targetPlayoffCount = 0;
    const seedCounts = {};
    
    for (let i = 0; i < MONTE_CARLO_ITERATIONS; i++) {
        // Generate random outcomes for undecided games
        const outcomes = { ...userOutcomes };
        
        criticalGames.forEach(game => {
            if (!outcomes[game.id]) {
                outcomes[game.id] = getGameOutcome(game);
            }
        });
        
        const result = simulateScenario(outcomes);
        
        if (result.targetMadePlayoffs) {
            targetPlayoffCount++;
            seedCounts[result.targetSeed] = (seedCounts[result.targetSeed] || 0) + 1;
        }
    }
    
    const playoffProbability = (targetPlayoffCount / MONTE_CARLO_ITERATIONS) * 100;
    
    return {
        playoffProbability,
        targetPlayoffCount,
        totalIterations: MONTE_CARLO_ITERATIONS,
        seedCounts
    };
}

// ========================================
// BEST/WORST CASE SCENARIOS
// ========================================

/**
 * Find the best possible scenario for target team
 */
export function findBestCaseScenario() {
    const criticalGames = getCriticalGames();
    const userOutcomes = getUserOutcomes();
    const allStandings = getAllStandings();
    const targetAbbr = getTargetTeam();
    
    // Get all undecided games (not locked by user)
    const undecidedGames = criticalGames.filter(g => !userOutcomes[g.id]);
    
    // Use brute force only for very small scenarios
    const maxBruteForce = 14; // 2^14 = 16,384 combinations (fast)
    
    if (undecidedGames.length <= maxBruteForce) {
        return findBestCaseBruteForce(undecidedGames);
    } else {
        return findBestCaseHeuristic(undecidedGames);
    }
}

/**
 * Brute force search for best case (small number of games)
 */
function findBestCaseBruteForce(undecidedGames) {
    const userOutcomes = getUserOutcomes();
    const criticalGames = getCriticalGames();
    const targetAbbr = getTargetTeam();
    
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
    const criticalGames = getCriticalGames();
    const userOutcomes = getUserOutcomes();
    
    // Get all undecided games (not locked by user)
    const undecidedGames = criticalGames.filter(g => !userOutcomes[g.id]);
    
    const maxBruteForce = 14; // 2^14 = 16,384 combinations (fast)
    
    if (undecidedGames.length <= maxBruteForce) {
        return findWorstCaseBruteForce(undecidedGames);
    } else {
        return findWorstCaseHeuristic(undecidedGames);
    }
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
