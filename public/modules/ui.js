// ui.js
// All UI rendering and user interaction handlers

import { 
    getTargetTeam,
    getAllStandings,
    getCriticalGames,
    getUserOutcomes,
    getCurrentWeek,
    getAsOfWeek,
    setTargetTeam,
    setUserOutcomes,
    setUserOutcome,
    removeUserOutcome,
    clearUserOutcomes,
    setUseWeightedSimulation,
    getTargetTeamData
} from './state.js';
import { calculatePlayoffTeams } from './playoff-calculator.js';
import { getTiebreakReason, createWildCardTiebreakSort, headToHeadRecords, conferenceRecords, commonGamesRecords } from './tiebreakers.js';
import { REGULAR_SEASON_WEEKS } from './constants.js';

// ========================================
// MAIN APP RENDERING
// ========================================

/**
 * Render the main app structure
 */
export function renderApp(onCalculateScenarios, onAsOfWeekChange) {
    const targetTeam = getTargetTeamData();
    const currentWeek = getCurrentWeek();
    const asOfWeek = getAsOfWeek() ?? currentWeek ?? 1;
    const criticalGames = getCriticalGames();
    const teamName = targetTeam ? targetTeam.name : 'Team';
    const teamDivision = targetTeam ? targetTeam.division : '';
    const teamNameWithDivision = targetTeam ? `${teamName} (${teamDivision})` : 'Team';
    
    const remainingWeeks = Math.max(0, REGULAR_SEASON_WEEKS - (asOfWeek || 0));
    const weekLabel = currentWeek && asOfWeek && currentWeek !== asOfWeek
        ? `Week ${asOfWeek} Standings (current week ${currentWeek})`
        : `Week ${asOfWeek} Standings`;

    const weekOptions = [];
    for (let week = 1; week <= REGULAR_SEASON_WEEKS; week++) {
        const isDisabled = currentWeek && week > currentWeek;
        const isSelected = week === asOfWeek;
        const label = currentWeek && week === currentWeek ? `Week ${week} (current)` : `Week ${week}`;
        weekOptions.push(
            `<option value="${week}" ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}>${label}</option>`
        );
    }

    document.getElementById('app').innerHTML = `
        <h2 style="text-align: center; margin: 30px 0 10px 0; font-size: 1.5em;">
            ${weekLabel} (${remainingWeeks} regular season weeks remaining)
        </h2>
        <div class="time-travel-bar">
            <label for="asOfWeekSelect">View standings as of</label>
            <select id="asOfWeekSelect" aria-label="View standings as of week">
                ${weekOptions.join('')}
            </select>
            <span class="time-travel-current">Current week: ${currentWeek || asOfWeek}</span>
        </div>
        
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
                <div class="seed-breakdown collapsible-content">
                    <span>Seed distribution</span>
                    <span class="tiebreak-info seed-info" id="seedDistributionInfo" data-tooltip="Seed distribution">ⓘ</span>
                    <button class="seed-toggle" id="seedDistributionToggle" type="button" aria-expanded="false" aria-controls="seedDistributionChart">
                        Show graph
                    </button>
                </div>
                <div class="seed-chart collapsible-content" id="seedDistributionChart"></div>
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
    setupEventHandlers(onCalculateScenarios, onAsOfWeekChange);
}

/**
 * Set up all UI event handlers
 */
function setupEventHandlers(onCalculateScenarios, onAsOfWeekChange) {
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

    const asOfSelect = document.getElementById('asOfWeekSelect');
    if (asOfSelect && onAsOfWeekChange) {
        asOfSelect.addEventListener('change', (event) => {
            const nextWeek = parseInt(event.target.value, 10);
            if (Number.isInteger(nextWeek)) {
                onAsOfWeekChange(nextWeek);
            }
        });
    }

    const seedToggle = document.getElementById('seedDistributionToggle');
    if (seedToggle) {
        seedToggle.addEventListener('click', () => {
            const chart = document.getElementById('seedDistributionChart');
            if (!chart) return;
            const isOpen = chart.classList.toggle('is-open');
            seedToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            seedToggle.textContent = isOpen ? 'Hide graph' : 'Show graph';
        });
    }
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
    // Use createWildCardTiebreakSort which properly handles same-division teams
    nonPlayoffTeams.sort(createWildCardTiebreakSort());
    
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
export function updatePlayoffChancesDisplay(probability, made, total, bestCase, worstCase, seedCounts) {
    const targetAbbr = getTargetTeam();
    const allStandings = getAllStandings();
    
    document.getElementById('playoffPercentage').textContent = `${Math.round(probability)}%`;
    document.getElementById('playoffStatus').textContent = 
        `Made playoffs in ${made} of ${total} simulated scenarios`;

    const seedInfo = document.getElementById('seedDistributionInfo');
    const seedChart = document.getElementById('seedDistributionChart');
    const seedToggle = document.getElementById('seedDistributionToggle');
    if (seedInfo && seedCounts) {
        const lines = [`Seed distribution (${total} sims)`];
        const chartRows = [];
        for (let seed = 1; seed <= 7; seed++) {
            const count = seedCounts[seed] || 0;
            if (count > 0) {
                lines.push(`#${seed}: ${count}`);
            }
            const pct = total > 0 ? (count / total) * 100 : 0;
            chartRows.push({
                label: `#${seed}`,
                count,
                pct,
                className: ''
            });
        }
        const missed = Math.max(0, total - made);
        if (missed > 0) lines.push(`Missed playoffs: ${missed}`);
        const missedPct = total > 0 ? (missed / total) * 100 : 0;
        chartRows.push({
            label: 'Miss',
            count: missed,
            pct: missedPct,
            className: 'missed'
        });
        seedInfo.dataset.tooltip = lines.join('\n');
        seedInfo.style.display = 'inline-flex';

        if (seedChart) {
            seedChart.innerHTML = chartRows.map(row => `
                <div class="seed-chart-row ${row.className}">
                    <span class="seed-label">${row.label}</span>
                    <div class="seed-bar"><span style="width: ${Math.min(100, row.pct)}%"></span></div>
                    <span class="seed-count">${row.pct.toFixed(1)}%</span>
                </div>
            `).join('');
        }

        if (seedToggle) {
            seedToggle.disabled = false;
            seedToggle.style.display = 'inline-flex';
        }
    } else if (seedInfo) {
        seedInfo.dataset.tooltip = 'Seed distribution unavailable';
        seedInfo.style.display = 'none';
        if (seedChart) seedChart.innerHTML = '';
        if (seedToggle) {
            seedToggle.disabled = true;
            seedToggle.style.display = 'none';
        }
    }
    
    // Update best case scenario
    const bestCaseEl = document.getElementById('bestCaseScenario');
    const bestHintEl = document.querySelector('#bestCaseScenarioItem .scenario-hint');
    if (!bestCase || !bestCase.result) {
        bestCaseEl.textContent = 'Disabled for now';
        if (bestHintEl) bestHintEl.textContent = 'Best case disabled';
        document.getElementById('bestCaseScenarioItem').classList.add('scenario-disabled');
    } else {
    document.getElementById('bestCaseScenarioItem').classList.remove('scenario-disabled');
    if (bestHintEl) {
        bestHintEl.textContent = bestCase.source === 'monteCarlo'
            ? 'Sampled from Monte Carlo runs'
            : 'Click to apply outcomes';
    }
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
    }
    
    // Update worst case scenario
    const worstCaseEl = document.getElementById('worstCaseScenario');
    const worstHintEl = document.querySelector('#worstCaseScenarioItem .scenario-hint');
    if (!worstCase || !worstCase.result) {
        worstCaseEl.textContent = 'Disabled for now';
        if (worstHintEl) worstHintEl.textContent = 'Worst case disabled';
        document.getElementById('worstCaseScenarioItem').classList.add('scenario-disabled');
        return;
    }
    document.getElementById('worstCaseScenarioItem').classList.remove('scenario-disabled');
    if (worstHintEl) {
        worstHintEl.textContent = worstCase.source === 'monteCarlo'
            ? 'Sampled from Monte Carlo runs'
            : 'Click to apply outcomes';
    }
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
