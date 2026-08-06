// app.js
// Main application coordinator - brings all modules together

import { DEFAULT_TARGET_TEAM, getConference, getDivision } from './modules/constants.js';
import {
    setTargetTeam,
    setAllStandings,
    setAllGames,
    setCriticalGames,
    getCurrentWeek,
    setAsOfWeek
} from './modules/state.js';
import { fetchDbSeasonData } from './modules/api.js';
import { buildTiebreakRecordsFromGames, setTiebreakRecords } from './modules/tiebreakers.js';
import { identifyCriticalGames } from './modules/playoff-calculator.js';
import {
    runMonteCarloSimulation,
} from './modules/simulation.js';
import {
    renderApp,
    updatePlayoffChancesDisplay,
    setOutcomeHandler,
    selectTeamHandler,
    setupGlobalEventDelegation
} from './modules/ui.js';

let baseAllGames = [];
let baseTeams = [];

// ========================================
// INITIALIZATION
// ========================================

/**
 * Initialize the application
 */
async function initializeApp() {
    try {
        // Fetch data from DB only
        const { standings, allGames, currentWeek } = await fetchDbSeasonData();
        baseAllGames = Array.isArray(allGames) ? allGames : [];
        baseTeams = buildBaseTeams(baseAllGames, standings);

        applyAsOfWeek(currentWeek || 1);
        
        // Identify critical games
        const critical = identifyCriticalGames();
        setCriticalGames(critical);
        
        // Set up global event delegation
        setupGlobalEventDelegation({
            onSetOutcome: (gameId, outcome) => setOutcomeHandler(gameId, outcome, calculateAndDisplayScenarios),
            onSelectTeam: (teamAbbr) => selectTeamHandler(teamAbbr, identifyCriticalGamesHandler, calculateAndDisplayScenarios, renderAppHandler),
            onApplyBestCase: bestWorstDisabled,
            onApplyWorstCase: bestWorstDisabled
        });
        
        // Render the UI
        renderAppHandler();
        
        // Calculate initial scenarios
        calculateAndDisplayScenarios();
        
    } catch (error) {
        console.error('Error initializing app:', error);
        document.getElementById('app').innerHTML = `
            <div class="error">
                <strong>Error loading data:</strong> ${error.message}
                <br><br>
                Check the console (F12) for details.
            </div>
        `;
    }
}

// ========================================
// HELPER FUNCTIONS FOR CALLBACKS
// ========================================

/**
 * Re-identify critical games (wrapper for callbacks)
 */
function identifyCriticalGamesHandler() {
    const critical = identifyCriticalGames();
    setCriticalGames(critical);
}

function handleAsOfWeekChange(week) {
    applyAsOfWeek(week);
    identifyCriticalGamesHandler();
    renderAppHandler();
    calculateAndDisplayScenarios();
}

/**
 * Render app wrapper (wrapper for callbacks)
 */
function renderAppHandler() {
    renderApp(calculateAndDisplayScenarios, handleAsOfWeekChange);
}

/**
 * Get current best case from state
 */
const bestWorstDisabled = () => null;

function applyAsOfWeek(week) {
    const currentWeek = getCurrentWeek() || 1;
    const nextWeek = Math.min(Math.max(1, week || 1), currentWeek);
    setAsOfWeek(nextWeek);

    const normalizedGames = normalizeGamesForWeek(baseAllGames, nextWeek);
    setAllGames(normalizedGames);

    const finalGames = normalizedGames.filter(game => game.status === 'final');
    const tiebreakRecords = buildTiebreakRecordsFromGames(finalGames);
    setTiebreakRecords(tiebreakRecords);

    const standings = buildStandingsFromRecords(baseTeams, tiebreakRecords.teamRecords);
    setAllStandings(standings);
}

function normalizeGamesForWeek(games, asOfWeek) {
    if (!Array.isArray(games)) return [];
    return games.map(game => {
        if (!Number.isInteger(game.week)) return game;
        if (game.status !== 'final') return game;
        if (game.week <= asOfWeek) return game;
        return { ...game, status: 'scheduled' };
    });
}

function buildBaseTeams(games, standings) {
    const standingsMap = new Map((standings || []).map(team => [team.abbr, team]));
    const teamMap = new Map();

    const addTeam = (team) => {
        if (!team?.abbr) return;
        if (teamMap.has(team.abbr)) return;

        const existing = standingsMap.get(team.abbr);
        const division = existing?.division || getDivision(team.abbr) || 'Unknown';
        const conference = existing?.conference || getConference(team.abbr) || (division.startsWith('NFC') ? 'NFC' : 'AFC');
        teamMap.set(team.abbr, {
            id: team.abbr,
            abbr: team.abbr,
            name: existing?.name || team.name || team.abbr,
            logo: existing?.logo || team.logo || '',
            division,
            conference
        });
    };

    (games || []).forEach(game => {
        addTeam(game.homeTeam);
        addTeam(game.awayTeam);
    });

    (standings || []).forEach(team => addTeam(team));

    return Array.from(teamMap.values());
}

function buildStandingsFromRecords(baseTeamsList, teamRecords) {
    const records = teamRecords || {};
    const standings = (baseTeamsList || []).map(team => {
        const record = records[team.abbr] || { wins: 0, losses: 0, ties: 0 };
        const total = record.wins + record.losses + record.ties;
        const winPct = total > 0 ? (record.wins + 0.5 * record.ties) / total : 0;
        return {
            ...team,
            wins: record.wins,
            losses: record.losses,
            ties: record.ties,
            winPct,
            tiebreakReason: null
        };
    });

    standings.sort((a, b) => {
        if (b.winPct !== a.winPct) return b.winPct - a.winPct;
        return 0;
    });

    return standings;
}

// ========================================
// SCENARIO CALCULATION
// ========================================

/**
 * Calculate and display playoff scenarios
 */
function calculateAndDisplayScenarios() {
    // Run Monte Carlo simulation
    const monteCarloResults = runMonteCarloSimulation();
    
    // Update display (best/worst are disabled for now)
    updatePlayoffChancesDisplay(
        monteCarloResults.playoffProbability,
        monteCarloResults.targetPlayoffCount,
        monteCarloResults.totalIterations,
        monteCarloResults.bestResult ? { result: monteCarloResults.bestResult, source: 'monteCarlo' } : null,
        monteCarloResults.worstResult ? { result: monteCarloResults.worstResult, source: 'monteCarlo' } : null,
        monteCarloResults.seedCounts
    );
}

// ========================================
// START APPLICATION
// ========================================

// Wait for DOM to be ready
window.addEventListener('DOMContentLoaded', async () => {
    // Set default target team
    setTargetTeam(DEFAULT_TARGET_TEAM);
    
    // Initialize the app
    await initializeApp();
});
