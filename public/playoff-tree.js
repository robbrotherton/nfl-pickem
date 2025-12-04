// NFL Playoff Scenario Calculator
// Standalone test version - uses ESPN API directly

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
let TARGET_TEAM = 'CHI'; // Default to Chicago Bears
const CURRENT_SEASON = 2025; // 2025 season
const CURRENT_WEEK = 14; // We're in week 14, looking at remaining games

// Global state
let allStandings = []; // All NFL teams
let allGames = [];
let criticalGames = [];
let userOutcomes = {}; // gameId -> 'home' or 'away'
let currentBestCase = null; // Store best case scenario
let currentWorstCase = null; // Store worst case scenario
let useWeightedSimulation = false; // Toggle between random (dice) and weighted (by record)
let conferenceRecords = {}; // Team -> {wins, losses, ties} in conference games
let divisionRecords = {}; // Team -> {wins, losses, ties} in division games
let commonGamesRecords = {}; // "TEAM1_vs_TEAM2" -> {team, opponent, wins, losses, ties, winPct}
let headToHeadRecords = {}; // "TEAM1_vs_TEAM2" -> {team, opponent, wins, losses, ties, winPct}

// ========================================
// INITIALIZATION
// ========================================

window.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
});

async function initializeApp() {
    try {
        // Fetch data from ESPN and local server
        await fetchStandings();
        await fetchRemainingGames();
        await fetchTiebreakRecords();
        
        // Identify critical games
        identifyCriticalGames();
        
        // Render the UI
        renderApp();
        
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
// DATA FETCHING
// ========================================

async function fetchStandings() {
    // Build standings from scoreboard data (weeks 1-current)
    const teamMap = new Map();
    
    // Fetch all weeks so far to build current standings
    for (let week = 1; week <= CURRENT_WEEK; week++) {
        const response = await fetch(`${ESPN_API_BASE}/scoreboard?seasontype=2&week=${week}`);
        const data = await response.json();
        
        if (data.events) {
            data.events.forEach(event => {
                const competition = event.competitions[0];
                const homeTeam = competition.competitors.find(t => t.homeAway === 'home');
                const awayTeam = competition.competitors.find(t => t.homeAway === 'away');
                
                // Store team info (will get updated each week with latest record)
                [homeTeam, awayTeam].forEach(competitor => {
                    const team = competitor.team;
                    const record = competitor.records?.[0];
                    
                    if (record) {
                        const [wins, losses, ties = 0] = record.summary.split('-').map(n => parseInt(n) || 0);
                        
                        teamMap.set(team.abbreviation, {
                            id: team.id,
                            name: team.displayName,
                            abbr: team.abbreviation,
                            logo: team.logo,
                            location: team.location,
                            wins,
                            losses,
                            ties,
                            winPct: (wins + 0.5 * ties) / (wins + losses + ties)
                        });
                    }
                });
            });
        }
    }
    
    // Division map for all NFL teams
    const divisionMap = {
        // NFC North
        'CHI': 'NFC North', 'DET': 'NFC North', 'GB': 'NFC North', 'MIN': 'NFC North',
        // NFC South
        'ATL': 'NFC South', 'CAR': 'NFC South', 'NO': 'NFC South', 'TB': 'NFC South',
        // NFC East
        'DAL': 'NFC East', 'NYG': 'NFC East', 'PHI': 'NFC East', 'WAS': 'NFC East', 'WSH': 'NFC East',
        // NFC West
        'ARI': 'NFC West', 'LAR': 'NFC West', 'SF': 'NFC West', 'SEA': 'NFC West',
        // AFC North
        'BAL': 'AFC North', 'CIN': 'AFC North', 'CLE': 'AFC North', 'PIT': 'AFC North',
        // AFC South
        'HOU': 'AFC South', 'IND': 'AFC South', 'JAX': 'AFC South', 'JAC': 'AFC South', 'TEN': 'AFC South',
        // AFC East
        'BUF': 'AFC East', 'MIA': 'AFC East', 'NE': 'AFC East', 'NYJ': 'AFC East',
        // AFC West
        'DEN': 'AFC West', 'KC': 'AFC West', 'LV': 'AFC West', 'OAK': 'AFC West', 'LAC': 'AFC West'
    };
    
    allStandings = Array.from(teamMap.values())
        .map(team => ({
            ...team,
            division: divisionMap[team.abbr] || 'Unknown',
            conference: divisionMap[team.abbr]?.startsWith('NFC') ? 'NFC' : 'AFC'
        }));
    
    // Sort by wins (descending)
    allStandings.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return 0;
    });
}

async function fetchRemainingGames() {
    allGames = [];
    
    // Fetch remaining weeks (current week + future weeks through week 18)
    for (let week = CURRENT_WEEK; week <= 18; week++) {
        const response = await fetch(`${ESPN_API_BASE}/scoreboard?seasontype=2&week=${week}`);
        const data = await response.json();
        
        if (data.events) {
            data.events.forEach(event => {
                const competition = event.competitions[0];
                const homeTeam = competition.competitors.find(t => t.homeAway === 'home');
                const awayTeam = competition.competitors.find(t => t.homeAway === 'away');
                
                // Only include games that haven't been played yet
                const status = competition.status.type.state;
                if (status === 'pre') {
                    allGames.push({
                        id: event.id,
                        week: week,
                        date: new Date(event.date),
                        homeTeam: {
                            id: homeTeam.team.id,
                            abbr: homeTeam.team.abbreviation,
                            name: homeTeam.team.displayName,
                            logo: homeTeam.team.logo,
                            record: homeTeam.records?.[0]?.summary || '0-0'
                        },
                        awayTeam: {
                            id: awayTeam.team.id,
                            abbr: awayTeam.team.abbreviation,
                            name: awayTeam.team.displayName,
                            logo: awayTeam.team.logo,
                            record: awayTeam.records?.[0]?.summary || '0-0'
                        }
                    });
                }
            });
        }
    }
}

async function fetchTiebreakRecords() {
    try {
        // Try to fetch from local server
        const [confResponse, divResponse, commonResponse, h2hResponse] = await Promise.all([
            fetch(`http://localhost:3000/api/conference-records/${CURRENT_SEASON}`),
            fetch(`http://localhost:3000/api/division-records/${CURRENT_SEASON}`),
            fetch(`http://localhost:3000/api/common-games/${CURRENT_SEASON}`),
            fetch(`http://localhost:3000/api/head-to-head/${CURRENT_SEASON}`)
        ]);
        
        if (confResponse.ok && divResponse.ok && commonResponse.ok && h2hResponse.ok) {
            conferenceRecords = await confResponse.json();
            divisionRecords = await divResponse.json();
            commonGamesRecords = await commonResponse.json();
            headToHeadRecords = await h2hResponse.json();
        }
    } catch (error) {
        console.warn('⚠️ Server not available for tiebreaker records');
    }
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function getTiebreakReason(teamA, teamB, context = 'division') {
    // Returns the reason why teamA beats teamB (or null if no tiebreaker needed)
    // context: 'division' or 'wildcard'
    
    // Check if teams are actually tied
    if (teamA.wins !== teamB.wins || teamA.losses !== teamB.losses) {
        return null;
    }
    
    if (context === 'division') {
        // Division tiebreakers
        // 1. Head-to-head
        const h2hKey = `${teamA.abbr}_vs_${teamB.abbr}`;
        if (headToHeadRecords[h2hKey]) {
            const h2hRec = headToHeadRecords[h2hKey];
            if (h2hRec.wins + h2hRec.losses + h2hRec.ties > 0) {
                const oppKey = `${teamB.abbr}_vs_${teamA.abbr}`;
                const oppRec = headToHeadRecords[oppKey];
                if (h2hRec.winPct > oppRec.winPct) {
                    return `Wins tie break over ${teamB.abbr} based on head-to-head (${h2hRec.wins}-${h2hRec.losses})`;
                }
            }
        }
        
        // 2. Division record
        if (divisionRecords[teamA.abbr] && divisionRecords[teamB.abbr]) {
            const aDiv = divisionRecords[teamA.abbr];
            const bDiv = divisionRecords[teamB.abbr];
            if (aDiv.wins > bDiv.wins || (aDiv.wins === bDiv.wins && aDiv.losses < bDiv.losses)) {
                return `Wins tie break over ${teamB.abbr} based on division record (${aDiv.wins}-${aDiv.losses} vs ${bDiv.wins}-${bDiv.losses})`;
            }
        }
        
        // 3. Common games
        const commonKey = `${teamA.abbr}_vs_${teamB.abbr}`;
        if (commonGamesRecords[commonKey]) {
            const aCommon = commonGamesRecords[commonKey];
            const oppKey = `${teamB.abbr}_vs_${teamA.abbr}`;
            const bCommon = commonGamesRecords[oppKey];
            if (aCommon.winPct > bCommon.winPct) {
                return `Wins tie break over ${teamB.abbr} based on common games (${aCommon.wins}-${aCommon.losses} vs ${bCommon.wins}-${bCommon.losses})`;
            }
        }
        
        // 4. Conference record
        if (conferenceRecords[teamA.abbr] && conferenceRecords[teamB.abbr]) {
            const aConf = conferenceRecords[teamA.abbr];
            const bConf = conferenceRecords[teamB.abbr];
            if (aConf.wins > bConf.wins || (aConf.wins === bConf.wins && aConf.losses < bConf.losses)) {
                return `Wins tie break over ${teamB.abbr} based on conference record (${aConf.wins}-${aConf.losses} vs ${bConf.wins}-${bConf.losses})`;
            }
        }
    } else {
        // Wild card tiebreakers
        // 1. Head-to-head (if applicable)
        const h2hKey = `${teamA.abbr}_vs_${teamB.abbr}`;
        if (headToHeadRecords[h2hKey]) {
            const h2hRec = headToHeadRecords[h2hKey];
            if (h2hRec.wins + h2hRec.losses + h2hRec.ties > 0) {
                const oppKey = `${teamB.abbr}_vs_${teamA.abbr}`;
                const oppRec = headToHeadRecords[oppKey];
                if (h2hRec.winPct > oppRec.winPct) {
                    return `Wins tie break over ${teamB.abbr} based on head-to-head (${h2hRec.wins}-${h2hRec.losses})`;
                }
            }
        }
        
        // 2. Conference record
        if (conferenceRecords[teamA.abbr] && conferenceRecords[teamB.abbr]) {
            const aConf = conferenceRecords[teamA.abbr];
            const bConf = conferenceRecords[teamB.abbr];
            if (aConf.wins > bConf.wins || (aConf.wins === bConf.wins && aConf.losses < bConf.losses)) {
                return `Wins tie break over ${teamB.abbr} based on conference record (${aConf.wins}-${aConf.losses} vs ${bConf.wins}-${bConf.losses})`;
            }
        }
        
        // 3. Common games
        const commonKey = `${teamA.abbr}_vs_${teamB.abbr}`;
        if (commonGamesRecords[commonKey]) {
            const aCommon = commonGamesRecords[commonKey];
            const oppKey = `${teamB.abbr}_vs_${teamA.abbr}`;
            const bCommon = commonGamesRecords[oppKey];
            if (aCommon.winPct > bCommon.winPct) {
                return `Wins tie break over ${teamB.abbr} based on common games (${aCommon.wins}-${aCommon.losses} vs ${bCommon.wins}-${bCommon.losses})`;
            }
        }
    }
    
    return null;
}

// Apply NFL tiebreaker rules to a group of teams with identical records
// Returns teams sorted with the winner first
function breakTieMultiTeam(tiedTeams, context = 'wildcard') {
    if (tiedTeams.length <= 1) return tiedTeams;
    
    // Make a copy to avoid mutating the original
    let remaining = [...tiedTeams];
    const sorted = [];
    
    while (remaining.length > 0) {
        if (remaining.length === 1) {
            sorted.push(remaining[0]);
            break;
        }
        
        // For wild card tiebreakers:
        // 1. Head-to-head sweep (one team beat all others)
        // 2. Conference record
        // 3. Common games
        // 4. Strength of victory, etc. (not implemented)
        
        let winner = null;
        let tiebreakReason = null;
        
        if (context === 'wildcard') {
            // 1. Check for head-to-head sweep
            for (const team of remaining) {
                let beatAllOthers = true;
                for (const opponent of remaining) {
                    if (team.abbr === opponent.abbr) continue;
                    
                    const h2hKey = `${team.abbr}_vs_${opponent.abbr}`;
                    const h2hRec = headToHeadRecords[h2hKey];
                    
                    if (!h2hRec || h2hRec.wins + h2hRec.losses + h2hRec.ties === 0) {
                        // Didn't play this opponent
                        beatAllOthers = false;
                        break;
                    }
                    
                    if (h2hRec.winPct <= 0.5) {
                        // Didn't beat this opponent
                        beatAllOthers = false;
                        break;
                    }
                }
                
                if (beatAllOthers) {
                    winner = team;
                    const otherTeams = remaining.filter(t => t.abbr !== team.abbr).map(t => t.abbr);
                    tiebreakReason = `Wins tie break over ${otherTeams.join(' and ')} based on head-to-head sweep`;
                    break;
                }
            }
            
            // 2. If no head-to-head sweep, use conference record
            if (!winner) {
                let bestConfRecord = null;
                let bestTeam = null;
                
                for (const team of remaining) {
                    const confRec = conferenceRecords[team.abbr];
                    if (!confRec) continue;
                    
                    if (!bestConfRecord || 
                        confRec.wins > bestConfRecord.wins ||
                        (confRec.wins === bestConfRecord.wins && confRec.losses < bestConfRecord.losses)) {
                        bestConfRecord = confRec;
                        bestTeam = team;
                    }
                }
                
                if (bestTeam && bestConfRecord) {
                    // Check if this team is clearly better (no other team has same conf record)
                    const teamsWithSameConfRecord = remaining.filter(t => {
                        const rec = conferenceRecords[t.abbr];
                        return rec && rec.wins === bestConfRecord.wins && rec.losses === bestConfRecord.losses;
                    });
                    
                    if (teamsWithSameConfRecord.length === 1) {
                        winner = bestTeam;
                        const otherTeams = remaining.filter(t => t.abbr !== bestTeam.abbr).map(t => t.abbr);
                        tiebreakReason = `Wins tie break over ${otherTeams.join(' and ')} based on conference record (${bestConfRecord.wins}-${bestConfRecord.losses})`;
                    }
                }
            }
            
            // 3. Common games (if no clear winner yet)
            // This is complex - skipping for now as conference record should handle most cases
        }
        
        // If we found a winner, add them and remove from remaining
        if (winner) {
            winner.tiebreakReason = tiebreakReason;
            sorted.push(winner);
            remaining = remaining.filter(t => t.abbr !== winner.abbr);
        } else {
            // No clear tiebreaker - just take the first one and continue
            // This shouldn't happen with proper tiebreaker implementation
            sorted.push(remaining[0]);
            remaining = remaining.slice(1);
        }
    }
    
    return sorted;
}

function getConferenceStandings(conference) {
    return allStandings.filter(t => t.conference === conference);
}

function getTargetConferenceStandings() {
    const targetTeam = allStandings.find(t => t.abbr === TARGET_TEAM);
    const conference = targetTeam?.conference || 'NFC';
    return getConferenceStandings(conference);
}

// ========================================
// CRITICAL GAMES IDENTIFICATION
// ========================================

function identifyCriticalGames() {
    const targetTeam = allStandings.find(t => t.abbr === TARGET_TEAM);
    const targetDivision = targetTeam?.division || 'NFC North';
    const targetConference = targetTeam?.conference || 'NFC';
    const conferenceStandings = getConferenceStandings(targetConference);
    const divisionTeams = allStandings.filter(t => t.division === targetDivision);
    
    criticalGames = allGames.filter(game => {
        const homeInConference = conferenceStandings.some(t => t.abbr === game.homeTeam.abbr);
        const awayInConference = conferenceStandings.some(t => t.abbr === game.awayTeam.abbr);
        
        // Skip games with no teams from target's conference
        if (!homeInConference && !awayInConference) return false;
        
        const homeInDivision = divisionTeams.some(t => t.abbr === game.homeTeam.abbr);
        const awayInDivision = divisionTeams.some(t => t.abbr === game.awayTeam.abbr);
        
        // Priority 1: Target team games
        if (game.homeTeam.abbr === TARGET_TEAM || game.awayTeam.abbr === TARGET_TEAM) {
            return true;
        }
        
        // Priority 2: Division games
        if (homeInDivision && awayInDivision) {
            return true;
        }
        
        // Priority 3: Division teams vs anyone in conference
        if ((homeInDivision && awayInConference) || (awayInDivision && homeInConference)) {
            return true;
        }
        
        // Priority 4: Wild card contenders (teams within 3 games of 7th place)
        const seventhPlace = allStandings[6];
        if (seventhPlace) {
            const homeTeamStanding = allStandings.find(t => t.abbr === game.homeTeam.abbr);
            const awayTeamStanding = allStandings.find(t => t.abbr === game.awayTeam.abbr);
            
            const homeInContention = homeTeamStanding && 
                Math.abs(homeTeamStanding.wins - seventhPlace.wins) <= 3;
            const awayInContention = awayTeamStanding && 
                Math.abs(awayTeamStanding.wins - seventhPlace.wins) <= 3;
            
            if (homeInContention && awayInContention) {
                return true;
            }
        }
        
        return false;
    });
    
    // Add impact scores
    criticalGames.forEach(game => {
        game.impact = calculateGameImpact(game);
    });
    
    // Sort by impact (highest first)
    criticalGames.sort((a, b) => b.impact.score - a.impact.score);
}

function calculateGameImpact(game) {
    let score = 0;
    let label = 'Low';
    
    const targetTeam = allStandings.find(t => t.abbr === TARGET_TEAM);
    const targetDivision = targetTeam?.division || 'NFC North';
    
    // Target team game = highest priority
    if (game.homeTeam.abbr === TARGET_TEAM || game.awayTeam.abbr === TARGET_TEAM) {
        score = 100;
        label = 'Critical';
    }
    // Both teams in target's division
    else if (allStandings.find(t => t.abbr === game.homeTeam.abbr)?.division === targetDivision &&
             allStandings.find(t => t.abbr === game.awayTeam.abbr)?.division === targetDivision) {
        score = 80;
        label = 'High';
    }
    // One team in target's division
    else if (allStandings.find(t => t.abbr === game.homeTeam.abbr)?.division === targetDivision ||
             allStandings.find(t => t.abbr === game.awayTeam.abbr)?.division === targetDivision) {
        score = 60;
        label = 'Medium';
    }
    // Both teams wild card contenders
    else {
        score = 40;
        label = 'Medium';
    }
    
    return { score, label };
}

// ========================================
// PLAYOFF CALCULATION
// ========================================

function calculatePlayoffTeams(standings) {
    // Group by division (dynamically to support both NFC and AFC)
    const divisions = {};
    
    standings.forEach(team => {
        if (!divisions[team.division]) {
            divisions[team.division] = [];
        }
        divisions[team.division].push(team);
    });
    
    // Get division winners (best record in each division)
    const divisionWinners = [];
    Object.keys(divisions).forEach(div => {
        const sorted = divisions[div].sort((a, b) => {
            // 1. Win percentage (properly handles ties)
            const aWinPct = a.winPct || 0;
            const bWinPct = b.winPct || 0;
            if (Math.abs(bWinPct - aWinPct) > 0.0001) {
                return bWinPct - aWinPct;
            }
            
            // Teams have same win percentage - apply NFL division tiebreakers
            // 1. Head-to-head record
            const h2hKey1 = `${a.abbr}_vs_${b.abbr}`;
            const h2hKey2 = `${b.abbr}_vs_${a.abbr}`;
            if (headToHeadRecords[h2hKey1] && headToHeadRecords[h2hKey2]) {
                const aH2HPct = headToHeadRecords[h2hKey1].winPct;
                const bH2HPct = headToHeadRecords[h2hKey2].winPct;
                
                if (Math.abs(bH2HPct - aH2HPct) > 0.001) {
                    return bH2HPct - aH2HPct;
                }
            }
            
            // 2. Division record (if available)
            if (divisionRecords[a.abbr] && divisionRecords[b.abbr]) {
                const aDivWins = divisionRecords[a.abbr].wins;
                const bDivWins = divisionRecords[b.abbr].wins;
                const aDivLosses = divisionRecords[a.abbr].losses;
                const bDivLosses = divisionRecords[b.abbr].losses;
                
                if (bDivWins !== aDivWins || aDivLosses !== bDivLosses) {
                    if (bDivWins !== aDivWins) return bDivWins - aDivWins;
                    if (aDivLosses !== bDivLosses) return aDivLosses - bDivLosses;
                }
            }
            
            // 3. Common games record (games vs opponents both teams played)
            const commonKey1 = `${a.abbr}_vs_${b.abbr}`;
            const commonKey2 = `${b.abbr}_vs_${a.abbr}`;
            if (commonGamesRecords[commonKey1] && commonGamesRecords[commonKey2]) {
                const aCommonPct = commonGamesRecords[commonKey1].winPct;
                const bCommonPct = commonGamesRecords[commonKey2].winPct;
                
                if (Math.abs(bCommonPct - aCommonPct) > 0.001) {
                    return bCommonPct - aCommonPct;
                }
            }
            
            // 4. Conference record (if available) - for division tiebreakers, this comes AFTER common games
            if (conferenceRecords[a.abbr] && conferenceRecords[b.abbr]) {
                const aConfWins = conferenceRecords[a.abbr].wins;
                const bConfWins = conferenceRecords[b.abbr].wins;
                const aConfLosses = conferenceRecords[a.abbr].losses;
                const bConfLosses = conferenceRecords[b.abbr].losses;
                
                if (bConfWins !== aConfWins || aConfLosses !== bConfLosses) {
                    if (bConfWins !== aConfWins) return bConfWins - aConfWins;
                    if (aConfLosses !== bConfLosses) return aConfLosses - bConfLosses;
                }
            }
            
            // 5. Win percentage (handles ties correctly)
            return (b.winPct || 0) - (a.winPct || 0);
        });
        
        // Add tiebreaker reasons for division teams
        for (let i = 0; i < sorted.length; i++) {
            const teamA = sorted[i];
            
            // Find all teams in this division with the same W-L record
            const tiedTeams = sorted.filter(t => 
                t.wins === teamA.wins && t.losses === teamA.losses
            );
            
            if (tiedTeams.length > 1 && !teamA.tiebreakReason) {
                // Find the teams this team beat in the tiebreaker
                const teamsBeaten = [];
                for (let j = i + 1; j < sorted.length; j++) {
                    const teamB = sorted[j];
                    if (teamB.wins === teamA.wins && teamB.losses === teamA.losses) {
                        teamsBeaten.push(teamB.abbr);
                    }
                }
                
                if (teamsBeaten.length > 0) {
                    const reason = getTiebreakReason(teamA, sorted.find(t => t.abbr === teamsBeaten[0]), 'division');
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
        
        // Add the division winner (preserving tiebreaker reason)
        if (sorted[0]) {
            divisionWinners.push({ 
                ...sorted[0], 
                isDivisionWinner: true,
                tiebreakReason: sorted[0].tiebreakReason // Preserve the tiebreaker reason
            });
        }
    });
    
    // Sort division winners by record
    divisionWinners.sort((a, b) => {
        // 1. Win percentage (properly handles ties)
        const aWinPct = a.winPct || 0;
        const bWinPct = b.winPct || 0;
        if (Math.abs(bWinPct - aWinPct) > 0.0001) {
            return bWinPct - aWinPct;
        }
        
        // Teams have same win percentage - apply tiebreakers
        // 3. Conference record (if available)
        if (conferenceRecords[a.abbr] && conferenceRecords[b.abbr]) {
            const aConfWins = conferenceRecords[a.abbr].wins;
            const bConfWins = conferenceRecords[b.abbr].wins;
            const aConfLosses = conferenceRecords[a.abbr].losses;
            const bConfLosses = conferenceRecords[b.abbr].losses;
            
            if (bConfWins !== aConfWins || aConfLosses !== bConfLosses) {
                if (bConfWins !== aConfWins) return bConfWins - aConfWins;
                if (aConfLosses !== bConfLosses) return aConfLosses - bConfLosses;
            }
        }
        // 4. Win percentage
        return (b.winPct || 0) - (a.winPct || 0);
    });
    
    // Add tiebreaker reasons for division winners seeding (seeds 1-4)
    for (let i = 0; i < divisionWinners.length; i++) {
        const teamA = divisionWinners[i];
        
        // Find all division winners with the same W-L record as teamA
        const tiedTeams = divisionWinners.filter(t => 
            t.wins === teamA.wins && t.losses === teamA.losses
        );
        
        // If there are multiple teams tied, add tiebreaker reason for teams that won the tiebreaker
        if (tiedTeams.length > 1 && !teamA.tiebreakReason) {
            // Find the teams this team beat in the tiebreaker (those that come after it)
            const teamsBeaten = [];
            for (let j = i + 1; j < divisionWinners.length; j++) {
                const teamB = divisionWinners[j];
                if (teamB.wins === teamA.wins && teamB.losses === teamA.losses) {
                    teamsBeaten.push(teamB.abbr);
                }
            }
            
            if (teamsBeaten.length > 0 && conferenceRecords[teamA.abbr]) {
                const aConf = conferenceRecords[teamA.abbr];
                const firstBeatenTeam = divisionWinners.find(t => t.abbr === teamsBeaten[0]);
                const bConf = conferenceRecords[firstBeatenTeam.abbr];
                
                if (aConf.wins > bConf.wins || (aConf.wins === bConf.wins && aConf.losses < bConf.losses)) {
                    if (teamsBeaten.length > 1) {
                        teamA.tiebreakReason = `Wins seeding tie break over ${teamsBeaten.join(' and ')} based on conference record (${aConf.wins}-${aConf.losses})`;
                    } else {
                        teamA.tiebreakReason = `Wins seeding tie break over ${teamsBeaten[0]} based on conference record (${aConf.wins}-${aConf.losses} vs ${bConf.wins}-${bConf.losses})`;
                    }
                }
            }
        }
    }
    
    // Get wild card teams (best remaining teams)
    const wildCardPool = standings.filter(team => 
        !divisionWinners.find(dw => dw.id === team.id)
    );
    
    // Sort wild card pool properly handling multi-team ties
    // First, do a basic sort by win percentage
    wildCardPool.sort((a, b) => {
        const aWinPct = a.winPct || 0;
        const bWinPct = b.winPct || 0;
        if (Math.abs(bWinPct - aWinPct) > 0.0001) {
            return bWinPct - aWinPct;
        }
        return 0; // Keep relative order for ties
    });
    
    // Now apply proper multi-team tiebreakers to groups with identical win percentage
    const sortedWildCardPool = [];
    let i = 0;
    while (i < wildCardPool.length) {
        const currentTeam = wildCardPool[i];
        const currentWinPct = currentTeam.winPct || 0;
        
        // Find all teams with the same win percentage
        const tiedGroup = [];
        for (let j = i; j < wildCardPool.length; j++) {
            const teamWinPct = wildCardPool[j].winPct || 0;
            if (Math.abs(teamWinPct - currentWinPct) < 0.0001) {
                tiedGroup.push(wildCardPool[j]);
            } else {
                break;
            }
        }
        
        if (tiedGroup.length > 1) {
            // Apply multi-team tiebreaker
            const brokenTie = breakTieMultiTeam(tiedGroup, 'wildcard');
            sortedWildCardPool.push(...brokenTie);
        } else {
            sortedWildCardPool.push(tiedGroup[0]);
        }
        
        i += tiedGroup.length;
    }
    
    // Replace wildCardPool with properly sorted version
    wildCardPool.length = 0;
    wildCardPool.push(...sortedWildCardPool);
    
    const wildCards = wildCardPool.slice(0, 3).map(team => ({ ...team, isWildCard: true }));
    
    // Combine and assign seeds
    const playoffTeams = [...divisionWinners, ...wildCards];
    playoffTeams.forEach((team, index) => {
        team.seed = index + 1;
    });
    
    return playoffTeams;
}

function simulateScenario(outcomes) {
    // Clone current standings
    const standings = JSON.parse(JSON.stringify(allStandings));
    
    // Get target team's conference
    const targetTeam = standings.find(t => t.abbr === TARGET_TEAM);
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
    const bearsMadePlayoffs = playoffTeams.some(t => t.abbr === TARGET_TEAM);
    const bearsSeed = playoffTeams.find(t => t.abbr === TARGET_TEAM)?.seed || null;
    
    // Calculate target team's position in division
    const bearsTeam = conferenceStandings.find(t => t.abbr === TARGET_TEAM);
    const divisionTeams = standings.filter(t => t.division === bearsTeam.division)
        .sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (a.losses !== b.losses) return a.losses - b.losses;
            return 0;
        });
    const bearsDivisionRank = divisionTeams.findIndex(t => t.abbr === TARGET_TEAM) + 1;
    
    // Calculate target team's position in wildcard race (among non-division winners)
    const divisionWinners = playoffTeams.filter(t => t.seed <= 4);
    const wildCardPool = conferenceStandings.filter(team => 
        !divisionWinners.find(dw => dw.id === team.id)
    ).sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return 0;
    });
    const bearsWildcardRank = wildCardPool.findIndex(t => t.abbr === TARGET_TEAM) + 1;
    
    return {
        standings,
        playoffTeams,
        bearsMadePlayoffs,
        bearsSeed,
        bearsDivisionRank,
        bearsWildcardRank
    };
}

// ========================================
// SCENARIO GENERATION
// ========================================

function getGameOutcome(game) {
    // Determine outcome based on simulation mode
    if (useWeightedSimulation) {
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
        const homeFieldBonus = 0.05;
        const totalWeight = homeWinPct + awayWinPct;
        const homeProb = totalWeight > 0 ? (homeWinPct / totalWeight) + homeFieldBonus : 0.5 + homeFieldBonus;
        
        return Math.random() < homeProb ? 'home' : 'away';
    } else {
        // Random 50/50
        return Math.random() < 0.5 ? 'home' : 'away';
    }
}

function calculateAndDisplayScenarios() {
    // Monte Carlo simulation: sample random outcomes
    const numSamples = 1000;
    let bearsPlayoffCount = 0;
    const seedCounts = {};
    
    for (let i = 0; i < numSamples; i++) {
        // Generate random outcomes for undecided games
        const outcomes = { ...userOutcomes };
        
        criticalGames.forEach(game => {
            if (!outcomes[game.id]) {
                outcomes[game.id] = getGameOutcome(game);
            }
        });
        
        const result = simulateScenario(outcomes);
        
        if (result.bearsMadePlayoffs) {
            bearsPlayoffCount++;
            seedCounts[result.bearsSeed] = (seedCounts[result.bearsSeed] || 0) + 1;
        }
    }
    
    const playoffProbability = (bearsPlayoffCount / numSamples) * 100;
    
    // Find best and worst case scenarios
    const bestCase = findBestCaseScenario();
    const worstCase = findWorstCaseScenario();
    
    // Store globally so they can be applied later
    currentBestCase = bestCase;
    currentWorstCase = worstCase;
    
    // Update display
    updatePlayoffChancesDisplay(playoffProbability, bearsPlayoffCount, numSamples, bestCase, worstCase);
}

function findBestCaseScenario() {
    // Get all undecided games (not locked by user)
    const undecidedGames = criticalGames.filter(g => !userOutcomes[g.id]);
    
    // Use brute force only for very small scenarios
    const maxBruteForce = 14; // 2^14 = 16,384 combinations (fast)
    
    if (undecidedGames.length <= maxBruteForce) {
        // Brute force all combinations
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
                (result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs) ||
                (result.bearsMadePlayoffs && bestResult.bearsMadePlayoffs && result.bearsSeed < bestResult.bearsSeed) ||
                (!result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs && 
                 (result.bearsWildcardRank < bestResult.bearsWildcardRank || result.bearsDivisionRank < bestResult.bearsDivisionRank))) {
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
    
    // For larger scenarios, use multiple strategic approaches
    const bearsGames = undecidedGames.filter(g => 
        g.homeTeam.abbr === TARGET_TEAM || g.awayTeam.abbr === TARGET_TEAM
    );
    
    // Get division rivals (other teams in same division)
    const targetTeam = allStandings.find(t => t.abbr === TARGET_TEAM);
    const targetDivision = targetTeam?.division || 'NFC North';
    const divisionRivals = allStandings
        .filter(t => t.division === targetDivision && t.abbr !== TARGET_TEAM)
        .map(t => t.abbr);
    
    const otherGames = undecidedGames.filter(g => 
        g.homeTeam.abbr !== TARGET_TEAM && g.awayTeam.abbr !== TARGET_TEAM
    );
    
    let bestResult = null;
    let bestOutcomes = null;
    
    // Strategy 1: Target team wins all, rivals lose all, others random (3000 samples)
    for (let i = 0; i < 3000; i++) {
        const outcomes = { ...userOutcomes };
        
        bearsGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === TARGET_TEAM ? 'home' : 'away';
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
            (result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs) ||
            (result.bearsMadePlayoffs && bestResult.bearsMadePlayoffs && result.bearsSeed < bestResult.bearsSeed) ||
            (!result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs && 
             (result.bearsWildcardRank < bestResult.bearsWildcardRank || result.bearsDivisionRank < bestResult.bearsDivisionRank))) {
            bestResult = result;
            bestOutcomes = outcomes;
        }
    }
    
    // Strategy 2: All non-Bears games favor higher seeds losing (helps wildcard chances)
    for (let i = 0; i < 1000; i++) {
        const outcomes = { ...userOutcomes };
        
        bearsGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === TARGET_TEAM ? 'home' : 'away';
        });
        
        otherGames.forEach(game => {
            // Favor upsets - helps Bears wildcard chances
            outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
        });
        
        const result = simulateScenario(outcomes);
        
        if (!bestResult || 
            (result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs) ||
            (result.bearsMadePlayoffs && bestResult.bearsMadePlayoffs && result.bearsSeed < bestResult.bearsSeed) ||
            (!result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs && 
             (result.bearsWildcardRank < bestResult.bearsWildcardRank || result.bearsDivisionRank < bestResult.bearsDivisionRank))) {
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

function findWorstCaseScenario() {
    // Get all undecided games (not locked by user)
    const undecidedGames = criticalGames.filter(g => !userOutcomes[g.id]);
    
    const maxBruteForce = 14; // 2^14 = 16,384 combinations (fast)
    
    if (undecidedGames.length <= maxBruteForce) {
        // Brute force all combinations
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
                (!result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs) ||
                (result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs && result.bearsSeed > worstResult.bearsSeed) ||
                (!result.bearsMadePlayoffs && !worstResult.bearsMadePlayoffs && 
                 (result.bearsWildcardRank > worstResult.bearsWildcardRank || result.bearsDivisionRank > worstResult.bearsDivisionRank))) {
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
    
    // For larger scenarios, use multiple strategic approaches
    const bearsGames = undecidedGames.filter(g => 
        g.homeTeam.abbr === TARGET_TEAM || g.awayTeam.abbr === TARGET_TEAM
    );
    
    // Get division rivals (other teams in same division)
    const targetTeam = allStandings.find(t => t.abbr === TARGET_TEAM);
    const targetDivision = targetTeam?.division || 'NFC North';
    const divisionRivals = allStandings
        .filter(t => t.division === targetDivision && t.abbr !== TARGET_TEAM)
        .map(t => t.abbr);
    
    const otherGames = undecidedGames.filter(g => 
        g.homeTeam.abbr !== TARGET_TEAM && g.awayTeam.abbr !== TARGET_TEAM
    );
    
    let worstResult = null;
    let worstOutcomes = null;
    
    // Strategy 1: Target team loses all, rivals win all, others random (3000 samples)
    for (let i = 0; i < 3000; i++) {
        const outcomes = { ...userOutcomes };
        
        bearsGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === TARGET_TEAM ? 'away' : 'home';
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
            (!result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs) ||
            (result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs && result.bearsSeed > worstResult.bearsSeed) ||
            (!result.bearsMadePlayoffs && !worstResult.bearsMadePlayoffs && 
             (result.bearsWildcardRank > worstResult.bearsWildcardRank || result.bearsDivisionRank > worstResult.bearsDivisionRank))) {
            worstResult = result;
            worstOutcomes = outcomes;
        }
    }
    
    // Strategy 2: All non-Bears games go chalk (favorites/better records win)
    for (let i = 0; i < 1000; i++) {
        const outcomes = { ...userOutcomes };
        
        bearsGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === TARGET_TEAM ? 'away' : 'home';
        });
        
        otherGames.forEach(game => {
            outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
        });
        
        const result = simulateScenario(outcomes);
        
        if (!worstResult || 
            (!result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs) ||
            (result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs && result.bearsSeed > worstResult.bearsSeed) ||
            (!result.bearsMadePlayoffs && !worstResult.bearsMadePlayoffs && 
             (result.bearsWildcardRank > worstResult.bearsWildcardRank || result.bearsDivisionRank > worstResult.bearsDivisionRank))) {
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

// ========================================
// UI RENDERING
// ========================================

function renderApp() {
    const targetTeam = allStandings.find(t => t.abbr === TARGET_TEAM);
    const teamName = targetTeam ? targetTeam.name : 'Team';
    const teamDivision = targetTeam ? targetTeam.division : '';
    const teamNameWithDivision = targetTeam ? `${teamName} (${teamDivision})` : 'Team';
    
    // Update page title
    document.getElementById('pageTitle').textContent = `🏈 ${teamNameWithDivision} Playoff Calculator`;
    
    document.getElementById('app').innerHTML = `
        <h2 style="text-align: center; margin: 30px 0 20px 0; font-size: 1.5em;">
            Week ${CURRENT_WEEK} Standings (${18 - CURRENT_WEEK} regular season games remaining)
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
        
        <div class="playoff-chances" id="playoffChances">
            <div class="playoff-chances-left">
                <h2>${teamNameWithDivision} Playoff Chances</h2>
                <div class="playoff-percentage" id="playoffPercentage">---%</div>
                <div class="playoff-status" id="playoffStatus">Calculating scenarios...</div>
                <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center; align-items: center;">
                    <button id="randomModeBtn" class="sim-mode-btn active" onclick="toggleSimulationMode(false)" title="Random outcomes (50/50)">
                        🎲
                    </button>
                    <button id="weightedModeBtn" class="sim-mode-btn" onclick="toggleSimulationMode(true)" title="Weighted by team records">
                        ⚖️
                    </button>
                </div>
            </div>
            <div class="playoff-chances-right">
                <div class="scenario-item" id="bestCaseScenarioItem" style="cursor: pointer; padding: 12px; border-radius: 8px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">
                    <h3>🎯 Best Case Scenario</h3>
                    <p id="bestCaseScenario">Loading...</p>
                    <p style="font-size: 0.85em; opacity: 0.7; margin-top: 8px;">Click to apply outcomes</p>
                </div>
                <div class="scenario-item" id="worstCaseScenarioItem" style="cursor: pointer; padding: 12px; border-radius: 8px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">
                    <h3>⚠️ Worst Case Scenario</h3>
                    <p id="worstCaseScenario">Loading...</p>
                    <p style="font-size: 0.85em; opacity: 0.7; margin-top: 8px;">Click to apply outcomes</p>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h2>🏈 Critical Games (${criticalGames.length})</h2>
            <p style="margin-bottom: 15px; color: #aaa; font-size: 0.95em;">
                Click outcomes to lock them in and see how it affects ${teamNameWithDivision} playoff chances
                <button id="clearAllBtn" style="margin-left: 15px; padding: 6px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 6px; cursor: pointer; font-size: 0.9em;" onclick="clearAllOutcomes()">Clear All</button>
            </p>
            <div id="keyGames"></div>
        </div>
    `;
    
    renderBothStandings();
    renderKeyGames();
    
    // Add click handlers for scenario items
    document.getElementById('bestCaseScenarioItem').addEventListener('click', applyBestCase);
    document.getElementById('worstCaseScenarioItem').addEventListener('click', applyWorstCase);
}

function applyBestCase() {
    if (!currentBestCase) return;
    
    // Apply all outcomes from best case scenario
    userOutcomes = { ...currentBestCase.outcomes };
    
    // Re-render games and recalculate
    renderKeyGames();
    calculateAndDisplayScenarios();
}

function applyWorstCase() {
    if (!currentWorstCase) return;
    
    // Apply all outcomes from worst case scenario
    userOutcomes = { ...currentWorstCase.outcomes };
    
    // Re-render games and recalculate
    renderKeyGames();
    calculateAndDisplayScenarios();
}

function clearAllOutcomes() {
    userOutcomes = {};
    renderKeyGames();
    calculateAndDisplayScenarios();
}

function toggleSimulationMode(weighted) {
    useWeightedSimulation = weighted;
    
    // Update button states
    document.getElementById('randomModeBtn').classList.toggle('active', !weighted);
    document.getElementById('weightedModeBtn').classList.toggle('active', weighted);
    
    // Recalculate scenarios with new mode
    calculateAndDisplayScenarios();
}

function selectTeam(teamAbbr) {
    TARGET_TEAM = teamAbbr;
    userOutcomes = {}; // Reset selected outcomes
    identifyCriticalGames(); // Recalculate critical games for new team
    renderApp(); // Re-render with new team
    calculateAndDisplayScenarios();
}

function renderBothStandings() {
    renderStandings('NFC', 'nfcStandingsTable');
    renderStandings('AFC', 'afcStandingsTable');
}

function renderStandings(conference, targetElementId) {
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
        const isTarget = team.abbr === TARGET_TEAM;
        const isDivWinner = playoffTeam?.isDivisionWinner;
        
        let rowClass = '';
        if (isTarget) rowClass = 'highlight';
        else if (isDivWinner) rowClass = 'division-winner';
        else if (isPlayoffTeam) rowClass = 'playoff-team';
        
        html += `<tr class="${rowClass}" onclick="selectTeam('${team.abbr}')" style="cursor: pointer;">`;
        
        if (isPlayoffTeam) {
            const seedClass = playoffTeam.seed <= 4 ? 'division-winner' : 'wildcard';
            html += `<td><span class="playoff-seed ${seedClass}">${playoffTeam.seed}</span></td>`;
        } else {
            html += `<td>${index + 1}</td>`;
        }
        
        html += `<td>
            <div class="team-info">
                <img src="${team.logo}" alt="${team.abbr}" class="team-logo" onerror="this.style.display='none'">
                <span>${team.name}</span>
                ${team.tiebreakReason ? `<span class="tiebreak-info" data-tooltip="${team.tiebreakReason}">ⓘ</span>` : ''}
            </div>
        </td>`;
        html += `<td>${team.wins}-${team.losses}${team.ties > 0 ? '-' + team.ties : ''}</td>`;
        html += `<td>${team.division}</td>`;
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    document.getElementById(targetElementId).innerHTML = html;
}

function renderKeyGames() {
    let html = '';
    
    criticalGames.forEach(game => {
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
                         onclick="setOutcome('${game.id}', 'away')">
                    ${game.awayTeam.abbr} wins
                 </button>`;
        html += `<button class="outcome-btn ${userOutcome === 'home' ? 'selected' : ''}" 
                         onclick="setOutcome('${game.id}', 'home')">
                    ${game.homeTeam.abbr} wins
                 </button>`;
        html += `<button class="outcome-btn reset ${!userOutcome ? 'selected' : ''}" 
                         onclick="setOutcome('${game.id}', null)">
                    ?
                 </button>`;
        html += `</div>`;
        
        html += `</div>`;
    });
    
    document.getElementById('keyGames').innerHTML = html;
}

function updatePlayoffChancesDisplay(probability, made, total, bestCase, worstCase) {
    document.getElementById('playoffPercentage').textContent = `${Math.round(probability)}%`;
    document.getElementById('playoffStatus').textContent = 
        `Made playoffs in ${made} of ${total} simulated scenarios`;
    
    // Update best case scenario
    const bestCaseEl = document.getElementById('bestCaseScenario');
    if (bestCase.result.bearsMadePlayoffs) {
        const bearsPlayoffTeam = bestCase.result.playoffTeams.find(t => t.abbr === TARGET_TEAM);
        
        if (bearsPlayoffTeam.isDivisionWinner) {
            const targetTeam = allStandings.find(t => t.abbr === TARGET_TEAM);
            const divisionName = targetTeam ? targetTeam.division : 'division';
            bestCaseEl.textContent = `Win ${divisionName} (#${bestCase.result.bearsSeed} seed)`;
        } else {
            // They're a wildcard - show which wildcard spot (1st, 2nd, or 3rd)
            const wildcards = bestCase.result.playoffTeams.filter(t => t.isWildCard);
            const wildcardPosition = wildcards.findIndex(t => t.abbr === TARGET_TEAM) + 1;
            const ordinal = (n) => ['1st', '2nd', '3rd'][n - 1] || n + 'th';
            bestCaseEl.textContent = `${ordinal(wildcardPosition)} wildcard (#${bestCase.result.bearsSeed} seed)`;
        }
    } else {
        // Show why they missed
        const divRank = bestCase.result.bearsDivisionRank;
        const wcRank = bestCase.result.bearsWildcardRank;
        const ordinal = (n) => {
            const s = ['th', 'st', 'nd', 'rd'];
            const v = n % 100;
            return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };
        bestCaseEl.textContent = `Miss playoffs (${ordinal(divRank)} in division, ${ordinal(wcRank)} in wildcard - need top 3)`;
    }
    
    // Update worst case scenario
    const worstCaseEl = document.getElementById('worstCaseScenario');
    if (worstCase.result.bearsMadePlayoffs) {
        const bearsPlayoffTeam = worstCase.result.playoffTeams.find(t => t.abbr === TARGET_TEAM);
        
        if (bearsPlayoffTeam.isDivisionWinner) {
            const targetTeam = allStandings.find(t => t.abbr === TARGET_TEAM);
            const divisionName = targetTeam ? targetTeam.division : 'division';
            worstCaseEl.textContent = `Win ${divisionName} (#${worstCase.result.bearsSeed} seed)`;
        } else {
            // They're a wildcard - show which wildcard spot (1st, 2nd, or 3rd)
            const wildcards = worstCase.result.playoffTeams.filter(t => t.isWildCard);
            const wildcardPosition = wildcards.findIndex(t => t.abbr === TARGET_TEAM) + 1;
            const ordinal = (n) => ['1st', '2nd', '3rd'][n - 1] || n + 'th';
            worstCaseEl.textContent = `${ordinal(wildcardPosition)} wildcard (#${worstCase.result.bearsSeed} seed)`;
        }
    } else {
        // Show why they missed
        const divRank = worstCase.result.bearsDivisionRank;
        const wcRank = worstCase.result.bearsWildcardRank;
        const ordinal = (n) => {
            const s = ['th', 'st', 'nd', 'rd'];
            const v = n % 100;
            return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };
        worstCaseEl.textContent = `Miss playoffs (${ordinal(divRank)} in division, ${ordinal(wcRank)} in wildcard - need top 3)`;
    }
}

// function updateBestCaseDisplay(bestCase) - NO LONGER USED
// This function was removed because we no longer display the detailed best case breakdown
// The best/worst case scenarios are now shown in the sticky header and are clickable

// ========================================
// USER INTERACTION
// ========================================

function setOutcome(gameId, outcome) {
    if (outcome === null) {
        delete userOutcomes[gameId];
    } else {
        userOutcomes[gameId] = outcome;
    }
    
    // Re-render games
    renderKeyGames();
    
    // Recalculate scenarios
    calculateAndDisplayScenarios();
}

// Make function available globally
window.setOutcome = setOutcome;
window.selectTeam = selectTeam;
window.clearAllOutcomes = clearAllOutcomes;
window.toggleSimulationMode = toggleSimulationMode;
