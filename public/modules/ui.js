// ui.js
// All UI rendering and user interaction handlers

import { 
    getTargetTeam,
    getAllStandings,
    getCriticalGames,
    getUserOutcomes,
    getCurrentWeek,
    setTargetTeam,
    setUserOutcomes,
    setUserOutcome,
    removeUserOutcome,
    clearUserOutcomes,
    setUseWeightedSimulation,
    getTargetTeamData
} from './state.js';
import { calculatePlayoffTeams } from './playoff-calculator.js';
import { getTiebreakReason, headToHeadRecords, conferenceRecords, commonGamesRecords } from './tiebreakers.js';
import { REGULAR_SEASON_WEEKS } from './constants.js';

// ========================================
// MAIN APP RENDERING
// ========================================

/**
 * Render the main app structure
 */
export function renderApp(onCalculateScenarios) {
    const targetTeam = getTargetTeamData();
    const currentWeek = getCurrentWeek();
    const criticalGames = getCriticalGames();
    const teamName = targetTeam ? targetTeam.name : 'Team';
    const teamDivision = targetTeam ? targetTeam.division : '';
    const teamNameWithDivision = targetTeam ? `${teamName} (${teamDivision})` : 'Team';
    
    document.getElementById('app').innerHTML = `
        <h2 style="text-align: center; margin: 30px 0 20px 0; font-size: 1.5em;">
            Week ${currentWeek} Standings (${REGULAR_SEASON_WEEKS - currentWeek} regular season games remaining)
        </h2>
        
        <div class="main-grid">
            <div class="card">
                <h2>📊 NFC Standings</h2>
                <div id="nfcStandingsTable"></div>
            </div>
            
            <div class="card">
                <h2>📊 AFC Standings</h2>
                <div id="afcStandingsTable"></div>
            </div>
        </div>
        
        <div class="playoff-chances collapsed">
            <button class="playoff-chances-toggle" title="Show/hide details">
                <span class="toggle-icon">ⓘ</span>
            </button>
            <div class="playoff-chances-left">
                <h2 class="team-header">${teamNameWithDivision} Playoff Chances</h2>
                <div class="playoff-percentage" id="playoffPercentage">---%</div>
                <div class="playoff-status collapsible-content" id="playoffStatus">Calculating scenarios...</div>
                <div class="collapsible-content" style="margin-top: 15px; display: flex; gap: 10px; justify-content: center; align-items: center;">
                    <button id="weightedModeBtn" class="sim-mode-btn active" title="Weighted by team records">
                        ⚖️
                    </button>
                    <button id="randomModeBtn" class="sim-mode-btn" title="Random outcomes (50/50)">
                        🎲
                    </button>
                </div>
            </div>
            <div class="playoff-chances-right collapsible-content">
                <div class="scenario-item clickable-scenario" id="bestCaseScenarioItem">
                    <h3>🎯 Best Case Scenario</h3>
                    <p id="bestCaseScenario">Loading...</p>
                    <p class="scenario-hint">Click to apply outcomes</p>
                </div>
                <div class="scenario-item clickable-scenario" id="worstCaseScenarioItem">
                    <h3>⚠️ Worst Case Scenario</h3>
                    <p id="worstCaseScenario">Loading...</p>
                    <p class="scenario-hint">Click to apply outcomes</p>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h2>🏈 Critical Games (${criticalGames.length})</h2>
            <p style="margin-bottom: 15px; color: #aaa; font-size: 0.95em;">
                Click outcomes to lock them in and see how it affects ${teamNameWithDivision} playoff chances
                <button id="clearAllBtn" style="margin-left: 15px; padding: 6px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 6px; cursor: pointer; font-size: 0.9em;">Clear All</button>
            </p>
            <div id="keyGames"></div>
        </div>
    `;
    
    renderBothStandings();
    renderKeyGames();
    
    // Set up event handlers
    setupEventHandlers(onCalculateScenarios);
}

/**
 * Set up all UI event handlers
 */
function setupEventHandlers(onCalculateScenarios) {
    // Simulation mode buttons
    document.getElementById('weightedModeBtn').addEventListener('click', () => {
        toggleSimulationMode(true, onCalculateScenarios);
    });
    document.getElementById('randomModeBtn').addEventListener('click', () => {
        toggleSimulationMode(false, onCalculateScenarios);
    });
    
    // Clear all button
    document.getElementById('clearAllBtn').addEventListener('click', () => {
        clearAllOutcomesHandler(onCalculateScenarios);
    });
    
    // Toggle playoff chances collapse (mobile)
    document.querySelector('.playoff-chances-toggle').addEventListener('click', () => {
        document.querySelector('.playoff-chances').classList.toggle('collapsed');
    });
}

// ========================================
// STANDINGS RENDERING
// ========================================

/**
 * Render both conference standings
 */
export function renderBothStandings() {
    renderStandings('NFC', 'nfcStandingsTable');
    renderStandings('AFC', 'afcStandingsTable');
}

/**
 * Render standings table for a conference
 */
function renderStandings(conference, targetElementId) {
    const allStandings = getAllStandings();
    const targetAbbr = getTargetTeam();
    
    // Get standings for the specified conference
    const conferenceStandings = allStandings.filter(team => team.conference === conference);
    const playoffTeams = calculatePlayoffTeams(conferenceStandings);
    const playoffIds = playoffTeams.map(t => t.id);
    
    // Create sorted list: playoff teams by seed, then non-playoff teams by record
    const playoffTeamsSorted = [...playoffTeams].sort((a, b) => a.seed - b.seed);
    const nonPlayoffTeams = conferenceStandings.filter(t => !playoffIds.includes(t.id));
    
    // Sort non-playoff teams with tiebreakers
    nonPlayoffTeams.sort((a, b) => {
        // 1. Win percentage (properly handles ties)
        const aWinPct = a.winPct || 0;
        const bWinPct = b.winPct || 0;
        if (Math.abs(bWinPct - aWinPct) > 0.0001) {
            return bWinPct - aWinPct;
        }
        
        // Teams have same win percentage - apply conference tiebreakers (same as wild card)
        // 1. Head-to-head (if applicable)
        const h2hKey1 = `${a.abbr}_vs_${b.abbr}`;
        const h2hKey2 = `${b.abbr}_vs_${a.abbr}`;
        if (headToHeadRecords[h2hKey1] && headToHeadRecords[h2hKey2]) {
            const aH2HPct = headToHeadRecords[h2hKey1].winPct;
            const bH2HPct = headToHeadRecords[h2hKey2].winPct;
            
            // Only apply if teams actually played each other
            const totalGames = headToHeadRecords[h2hKey1].wins + headToHeadRecords[h2hKey1].losses + headToHeadRecords[h2hKey1].ties;
            if (totalGames > 0 && Math.abs(bH2HPct - aH2HPct) > 0.001) {
                return bH2HPct - aH2HPct;
            }
        }
        
        // 2. Conference record (if available)
        if (conferenceRecords[a.abbr] && conferenceRecords[b.abbr]) {
            const aConfWins = conferenceRecords[a.abbr].wins;
            const bConfWins = conferenceRecords[b.abbr].wins;
            const aConfLosses = conferenceRecords[a.abbr].losses;
            const bConfLosses = conferenceRecords[b.abbr].losses;
            
            if (bConfWins !== aConfWins) return bConfWins - aConfWins;
            if (aConfLosses !== bConfLosses) return aConfLosses - bConfLosses;
        }
        
        // 3. Common games
        const commonKey1 = `${a.abbr}_vs_${b.abbr}`;
        const commonKey2 = `${b.abbr}_vs_${a.abbr}`;
        if (commonGamesRecords[commonKey1] && commonGamesRecords[commonKey2]) {
            const aCommonPct = commonGamesRecords[commonKey1].winPct;
            const bCommonPct = commonGamesRecords[commonKey2].winPct;
            
            if (Math.abs(bCommonPct - aCommonPct) > 0.001) {
                return bCommonPct - aCommonPct;
            }
        }
        
        // 4. Win percentage
        return (b.winPct || 0) - (a.winPct || 0);
    });
    
    // Add tiebreaker reasons for non-playoff teams
    for (let i = 0; i < nonPlayoffTeams.length; i++) {
        const teamA = nonPlayoffTeams[i];
        
        // Find all non-playoff teams with the same W-L record
        const tiedTeams = nonPlayoffTeams.filter(t => 
            t.wins === teamA.wins && t.losses === teamA.losses
        );
        
        if (tiedTeams.length > 1 && !teamA.tiebreakReason) {
            // Find the teams this team beat in the tiebreaker
            const teamsBeaten = [];
            for (let j = i + 1; j < nonPlayoffTeams.length; j++) {
                const teamB = nonPlayoffTeams[j];
                if (teamB.wins === teamA.wins && teamB.losses === teamA.losses) {
                    teamsBeaten.push(teamB.abbr);
                }
            }
            
            if (teamsBeaten.length > 0) {
                const reason = getTiebreakReason(teamA, nonPlayoffTeams.find(t => t.abbr === teamsBeaten[0]), 'wildcard');
                if (reason) {
                    if (teamsBeaten.length > 1) {
                        teamA.tiebreakReason = reason.replace(
                            `over ${teamsBeaten[0]}`,
                            `over ${teamsBeaten.join(' and ')}`
                        );
                    } else {
                        teamA.tiebreakReason = reason;
                    }
                }
            }
        }
    }
    
    const sortedTeams = [...playoffTeamsSorted, ...nonPlayoffTeams];
    
    let html = '<table class="standings-table">';
    html += '<thead><tr>';
    html += `<th>Seed</th><th>Team</th><th>Record</th><th>Division</th>`;
    html += '</tr></thead><tbody>';
    
    sortedTeams.forEach((team, index) => {
        const isPlayoffTeam = playoffIds.includes(team.id);
        const playoffTeam = playoffTeams.find(t => t.id === team.id);
        const isTarget = team.abbr === targetAbbr;
        const isDivWinner = playoffTeam?.isDivisionWinner;
        
        // Use ESPN's clincher status: 'z' = div, 'y' = playoff, 'e' = eliminated, '' = competing
        const isEliminated = team.clincher === 'e';
        const isClinched = team.clincher === 'y' || team.clincher === 'z';
        const isDivClinched = team.clincher === 'z';
        
        let rowClass = '';
        if (isTarget) rowClass = 'highlight';
        else if (isDivWinner) rowClass = 'division-winner';
        else if (isPlayoffTeam) rowClass = 'playoff-team';
        
        // Add status indicator classes
        if (isEliminated) rowClass += ' eliminated';
        if (isClinched) rowClass += ' clinched';
        
        html += `<tr class="${rowClass}" data-team="${team.abbr}" style="cursor: pointer;">`;
        
        // Determine seed class based on position
        let seedNum, seedClass;
        if (isPlayoffTeam) {
            seedNum = playoffTeam.seed;
            seedClass = playoffTeam.seed <= 4 ? 'division-winner' : 'wildcard';
        } else {
            seedNum = index + 1;
            seedClass = 'no-seed'; // No background for non-playoff teams
        }
        
        html += `<td><span class="playoff-seed ${seedClass}">${seedNum}</span>${team.tiebreakReason ? `<span class="tiebreak-info" data-tooltip="${team.tiebreakReason}">ⓘ</span>` : ''}</td>`;
        
        // Build clincher indicator for team name
        let clinchIndicator = '';
        if (isDivClinched) {
            clinchIndicator = '<span style="margin-left: 8px;" title="Clinched division">🏆</span>';
        } else if (isClinched) {
            clinchIndicator = '<span style="margin-left: 8px;" title="Clinched playoff spot">✅</span>';
        } else if (isEliminated) {
            clinchIndicator = '<span style="margin-left: 8px; opacity: 0.6;" title="Eliminated from playoff contention">❌</span>';
        }
        
        html += `<td>
            <div class="team-info">
                <img src="${team.logo}" alt="${team.abbr}" class="team-logo" onerror="this.style.display='none'">
                <span>${team.name}</span>
                ${clinchIndicator}
            </div>
        </td>`;
        html += `<td>${team.wins}-${team.losses}${team.ties > 0 ? '-' + team.ties : ''}</td>`;
        html += `<td>${team.division}</td>`;
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    document.getElementById(targetElementId).innerHTML = html;
}

// ========================================
// GAMES RENDERING
// ========================================

/**
 * Render critical games list
 */
export function renderKeyGames() {
    const criticalGames = getCriticalGames();
    const userOutcomes = getUserOutcomes();
    const allStandings = getAllStandings();
    
    let html = '';
    // Sort games by week (ascending) then by impact priority (Critical > High > Medium > Low)
    const priority = { 'Critical': 3, 'High': 2, 'Medium': 1, 'Low': 0 };
    const sortedGames = [...criticalGames].sort((a, b) => {
        if (a.week !== b.week) return a.week - b.week;
        const aPr = priority[a.impact?.label] ?? 0;
        const bPr = priority[b.impact?.label] ?? 0;
        return bPr - aPr; // higher priority first
    });

    sortedGames.forEach(game => {
        const impactClass = game.impact.label.toLowerCase();
        const userOutcome = userOutcomes[game.id];
        
        html += `<div class="game-item ${game.impact.label === 'Critical' ? 'critical' : ''}">`;
        html += `<div class="game-header">`;
        html += `<span class="game-week">Week ${game.week}</span>`;
        html += `<span class="game-impact ${impactClass}">${game.impact.label}</span>`;
        html += `</div>`;
        
        const awayTeamData = allStandings.find(t => t.abbr === game.awayTeam.abbr);
        const homeTeamData = allStandings.find(t => t.abbr === game.homeTeam.abbr);
        
        html += `<div class="matchup">`;
        html += `<div class="team">
            <img src="${game.awayTeam.logo}" alt="${game.awayTeam.abbr}">
            <span>${game.awayTeam.name}${awayTeamData ? ` (${awayTeamData.division})` : ''}</span>
            <span style="color: #888; font-size: 0.9em;">(${game.awayTeam.record})</span>
        </div>`;
        html += `<span class="vs">@</span>`;
        html += `<div class="team">
            <img src="${game.homeTeam.logo}" alt="${game.homeTeam.abbr}">
            <span>${game.homeTeam.name}${homeTeamData ? ` (${homeTeamData.division})` : ''}</span>
            <span style="color: #888; font-size: 0.9em;">(${game.homeTeam.record})</span>
        </div>`;
        html += `</div>`;
        
        html += `<div class="outcome-selector">`;
        html += `<button class="outcome-btn ${userOutcome === 'away' ? 'selected' : ''}" 
                         data-game-id="${game.id}" data-outcome="away">
                    ${game.awayTeam.abbr} wins
                 </button>`;
        html += `<button class="outcome-btn ${userOutcome === 'home' ? 'selected' : ''}" 
                         data-game-id="${game.id}" data-outcome="home">
                    ${game.homeTeam.abbr} wins
                 </button>`;
        html += `<button class="outcome-btn reset ${!userOutcome ? 'selected' : ''}" 
                         data-game-id="${game.id}" data-outcome="reset">
                    ?
                 </button>`;
        html += `</div>`;
        
        html += `</div>`;
    });
    
    document.getElementById('keyGames').innerHTML = html;
}

// ========================================
// PLAYOFF CHANCES DISPLAY
// ========================================

/**
 * Update the playoff chances display
 */
export function updatePlayoffChancesDisplay(probability, made, total, bestCase, worstCase) {
    const targetAbbr = getTargetTeam();
    const allStandings = getAllStandings();
    
    document.getElementById('playoffPercentage').textContent = `${Math.round(probability)}%`;
    document.getElementById('playoffStatus').textContent = 
        `Made playoffs in ${made} of ${total} simulated scenarios`;
    
    // Update best case scenario
    const bestCaseEl = document.getElementById('bestCaseScenario');
    if (bestCase.result.targetMadePlayoffs) {
        const targetPlayoffTeam = bestCase.result.playoffTeams.find(t => t.abbr === targetAbbr);
        
        if (targetPlayoffTeam.isDivisionWinner) {
            const targetTeam = allStandings.find(t => t.abbr === targetAbbr);
            const divisionName = targetTeam ? targetTeam.division : 'division';
            bestCaseEl.textContent = `Win ${divisionName} (#${bestCase.result.targetSeed} seed)`;
        } else {
            // They're a wildcard - show which wildcard spot (1st, 2nd, or 3rd)
            const wildcards = bestCase.result.playoffTeams.filter(t => t.isWildCard);
            const wildcardPosition = wildcards.findIndex(t => t.abbr === targetAbbr) + 1;
            const ordinal = (n) => ['1st', '2nd', '3rd'][n - 1] || n + 'th';
            bestCaseEl.textContent = `${ordinal(wildcardPosition)} wildcard (#${bestCase.result.targetSeed} seed)`;
        }
    } else {
        // Show why they missed
        const divRank = bestCase.result.targetDivisionRank;
        const wcRank = bestCase.result.targetWildcardRank;
        const ordinal = (n) => {
            const s = ['th', 'st', 'nd', 'rd'];
            const v = n % 100;
            return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };
        bestCaseEl.textContent = `Miss playoffs (${ordinal(divRank)} in division, ${ordinal(wcRank)} in wildcard - need top 3)`;
    }
    
    // Update worst case scenario
    const worstCaseEl = document.getElementById('worstCaseScenario');
    if (worstCase.result.targetMadePlayoffs) {
        const targetPlayoffTeam = worstCase.result.playoffTeams.find(t => t.abbr === targetAbbr);
        
        if (targetPlayoffTeam.isDivisionWinner) {
            const targetTeam = allStandings.find(t => t.abbr === targetAbbr);
            const divisionName = targetTeam ? targetTeam.division : 'division';
            worstCaseEl.textContent = `Win ${divisionName} (#${worstCase.result.targetSeed} seed)`;
        } else {
            // They're a wildcard - show which wildcard spot (1st, 2nd, or 3rd)
            const wildcards = worstCase.result.playoffTeams.filter(t => t.isWildCard);
            const wildcardPosition = wildcards.findIndex(t => t.abbr === targetAbbr) + 1;
            const ordinal = (n) => ['1st', '2nd', '3rd'][n - 1] || n + 'th';
            worstCaseEl.textContent = `${ordinal(wildcardPosition)} wildcard (#${worstCase.result.targetSeed} seed)`;
        }
    } else {
        // Show why they missed
        const divRank = worstCase.result.targetDivisionRank;
        const wcRank = worstCase.result.targetWildcardRank;
        const ordinal = (n) => {
            const s = ['th', 'st', 'nd', 'rd'];
            const v = n % 100;
            return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };
        worstCaseEl.textContent = `Miss playoffs (${ordinal(divRank)} in division, ${ordinal(wcRank)} in wildcard - need top 3)`;
    }
}

// ========================================
// USER INTERACTION HANDLERS
// ========================================

/**
 * Handle outcome button click
 */
export function setOutcomeHandler(gameId, outcome, onCalculateScenarios) {
    if (outcome === 'reset' || outcome === null) {
        removeUserOutcome(gameId);
    } else {
        setUserOutcome(gameId, outcome);
    }
    
    // Re-render games
    renderKeyGames();
    
    // Recalculate scenarios
    onCalculateScenarios();
}

/**
 * Handle team selection
 */
export function selectTeamHandler(teamAbbr, onIdentifyCritical, onCalculateScenarios, onRenderApp) {
    setTargetTeam(teamAbbr);
    clearUserOutcomes(); // Reset selected outcomes
    onIdentifyCritical(); // Recalculate critical games for new team
    onRenderApp(); // Re-render with new team
    onCalculateScenarios();
}

/**
 * Clear all user-selected outcomes
 */
function clearAllOutcomesHandler(onCalculateScenarios) {
    clearUserOutcomes();
    renderKeyGames();
    onCalculateScenarios();
}

/**
 * Toggle between weighted and random simulation modes
 */
function toggleSimulationMode(weighted, onCalculateScenarios) {
    setUseWeightedSimulation(weighted);
    
    // Update button states
    document.getElementById('randomModeBtn').classList.toggle('active', !weighted);
    document.getElementById('weightedModeBtn').classList.toggle('active', weighted);
    
    // Recalculate scenarios with new mode
    onCalculateScenarios();
}

/**
 * Apply best case scenario outcomes
 */
export function applyBestCaseHandler(bestCase, onCalculateScenarios) {
    if (!bestCase) return;
    
    // Apply all outcomes from best case scenario
    setUserOutcomes({ ...bestCase.outcomes });
    
    // Re-render games and recalculate
    renderKeyGames();
    onCalculateScenarios();
}

/**
 * Apply worst case scenario outcomes
 */
export function applyWorstCaseHandler(worstCase, onCalculateScenarios) {
    if (!worstCase) return;
    
    // Apply all outcomes from worst case scenario
    setUserOutcomes({ ...worstCase.outcomes });
    
    // Re-render games and recalculate
    renderKeyGames();
    onCalculateScenarios();
}

// ========================================
// EVENT DELEGATION
// ========================================

/**
 * Set up global event delegation for dynamic elements
 */
export function setupGlobalEventDelegation(callbacks) {
    const { onSetOutcome, onSelectTeam, onApplyBestCase, onApplyWorstCase } = callbacks;
    
    // Delegate outcome button clicks
    document.addEventListener('click', (e) => {
        const outcomeBtn = e.target.closest('.outcome-btn');
        if (outcomeBtn) {
            const gameId = outcomeBtn.getAttribute('data-game-id');
            const outcome = outcomeBtn.getAttribute('data-outcome');
            if (gameId && outcome) {
                onSetOutcome(gameId, outcome);
            }
        }
        
        // Delegate team selection clicks
        const teamRow = e.target.closest('tr[data-team]');
        if (teamRow) {
            const teamAbbr = teamRow.getAttribute('data-team');
            if (teamAbbr) {
                onSelectTeam(teamAbbr);
            }
        }
        
        // Best/worst case scenario clicks
        if (e.target.closest('#bestCaseScenarioItem')) {
            onApplyBestCase();
        }
        if (e.target.closest('#worstCaseScenarioItem')) {
            onApplyWorstCase();
        }
    });
}
