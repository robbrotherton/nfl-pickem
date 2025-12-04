// app.js
// Main application coordinator - brings all modules together

import { DEFAULT_TARGET_TEAM } from './modules/constants.js';
import {
    setTargetTeam,
    setAllStandings,
    setAllGames,
    setCriticalGames,
    setCurrentBestCase,
    setCurrentWorstCase
} from './modules/state.js';
import { fetchCurrentSeasonInfo, fetchStandings, fetchRemainingGames } from './modules/api.js';
import { fetchTiebreakRecords } from './modules/tiebreakers.js';
import { identifyCriticalGames } from './modules/playoff-calculator.js';
import {
    runMonteCarloSimulation,
    findBestCaseScenario,
    findWorstCaseScenario
} from './modules/simulation.js';
import {
    renderApp,
    renderKeyGames,
    updatePlayoffChancesDisplay,
    setOutcomeHandler,
    selectTeamHandler,
    applyBestCaseHandler,
    applyWorstCaseHandler,
    setupGlobalEventDelegation
} from './modules/ui.js';

// ========================================
// INITIALIZATION
// ========================================

/**
 * Initialize the application
 */
async function initializeApp() {
    try {
        // Fetch current season/week info first
        await fetchCurrentSeasonInfo();
        
        // Fetch data from ESPN and local server
        const standings = await fetchStandings();
        setAllStandings(standings);
        
        const games = await fetchRemainingGames();
        setAllGames(games);
        
        await fetchTiebreakRecords();
        
        // Identify critical games
        const critical = identifyCriticalGames();
        setCriticalGames(critical);
        
        // Set up global event delegation
        setupGlobalEventDelegation({
            onSetOutcome: (gameId, outcome) => setOutcomeHandler(gameId, outcome, calculateAndDisplayScenarios),
            onSelectTeam: (teamAbbr) => selectTeamHandler(teamAbbr, identifyCriticalGamesHandler, calculateAndDisplayScenarios, renderAppHandler),
            onApplyBestCase: () => applyBestCaseHandler(getBestCase(), calculateAndDisplayScenarios),
            onApplyWorstCase: () => applyWorstCaseHandler(getWorstCase(), calculateAndDisplayScenarios)
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

/**
 * Render app wrapper (wrapper for callbacks)
 */
function renderAppHandler() {
    renderApp(calculateAndDisplayScenarios);
}

/**
 * Get current best case from state
 */
let currentBestCase = null;
let currentWorstCase = null;

function getBestCase() {
    return currentBestCase;
}

function getWorstCase() {
    return currentWorstCase;
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
    
    // Find best and worst case scenarios
    const bestCase = findBestCaseScenario();
    const worstCase = findWorstCaseScenario();
    
    // Store globally for UI callbacks
    currentBestCase = bestCase;
    currentWorstCase = worstCase;
    setCurrentBestCase(bestCase);
    setCurrentWorstCase(worstCase);
    
    // Update display
    updatePlayoffChancesDisplay(
        monteCarloResults.playoffProbability,
        monteCarloResults.targetPlayoffCount,
        monteCarloResults.totalIterations,
        bestCase,
        worstCase
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
