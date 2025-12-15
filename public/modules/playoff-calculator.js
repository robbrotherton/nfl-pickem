// playoff-calculator.js
// NFL playoff calculation and critical games identification

import { PLAYOFF_SPOTS } from './constants.js';
import { 
    getTargetTeam, 
    getAllStandings, 
    getAllGames, 
    getTargetTeamData,
    getConferenceStandings,
    getDivisionStandings 
} from './state.js';
import { 
    getTiebreakReason, 
    breakTieMultiTeam, 
    createDivisionTiebreakSort, 
    createConferenceTiebreakSort,
    conferenceRecords 
} from './tiebreakers.js';

// ========================================
// CRITICAL GAMES IDENTIFICATION
// ========================================

/**
 * Identify which remaining games are critical for target team's playoff chances
 * Returns array of critical games sorted by impact score
 */
export function identifyCriticalGames() {
    const targetTeam = getTargetTeamData();
    const targetDivision = targetTeam?.division || 'NFC North';
    const targetConference = targetTeam?.conference || 'NFC';
    const conferenceStandings = getConferenceStandings(targetConference);
    const divisionTeams = getDivisionStandings(targetDivision);
    const allStandings = getAllStandings();
    const allGames = getAllGames();
    const targetAbbr = getTargetTeam();
    
    const critical = allGames.filter(game => {
        // Exclude games that are already final — they should not be interactive
        if (game.status === 'final') {
            // Debug: occasionally games come through with non-canonical statuses; log if it's for the target division
            // (This log is lightweight and helps diagnose stale or unexpected entries.)
            // console.debug(`Skipping final game ${game.id} (${game.homeTeam.abbr} @ ${game.awayTeam.abbr})`);
            return false;
        }
        const homeInConference = conferenceStandings.some(t => t.abbr === game.homeTeam.abbr);
        const awayInConference = conferenceStandings.some(t => t.abbr === game.awayTeam.abbr);
        
        // Skip games with no teams from target's conference
        if (!homeInConference && !awayInConference) return false;
        
        const homeInDivision = divisionTeams.some(t => t.abbr === game.homeTeam.abbr);
        const awayInDivision = divisionTeams.some(t => t.abbr === game.awayTeam.abbr);
        
        // Priority 1: Target team games
        if (game.homeTeam.abbr === targetAbbr || game.awayTeam.abbr === targetAbbr) {
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
    critical.forEach(game => {
        game.impact = calculateGameImpact(game);
    });
    
    // Sort by impact (highest first)
    critical.sort((a, b) => b.impact.score - a.impact.score);
    
    return critical;
}

/**
 * Calculate impact score for a game relative to target team
 */
function calculateGameImpact(game) {
    let score = 0;
    let label = 'Low';
    
    const targetTeam = getTargetTeamData();
    const targetDivision = targetTeam?.division || 'NFC North';
    const allStandings = getAllStandings();
    const targetAbbr = getTargetTeam();
    
    // Target team game = highest priority
    if (game.homeTeam.abbr === targetAbbr || game.awayTeam.abbr === targetAbbr) {
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

/**
 * Calculate playoff teams from conference standings
 * Returns array of 7 playoff teams with seeds
 */
export function calculatePlayoffTeams(standings) {
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
        const sorted = divisions[div].sort(createDivisionTiebreakSort());
        
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
    divisionWinners.sort(createConferenceTiebreakSort());
    
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
    
    const wildCards = wildCardPool.slice(0, PLAYOFF_SPOTS.WILD_CARDS).map(team => ({ ...team, isWildCard: true }));
    
    // Combine and assign seeds
    const playoffTeams = [...divisionWinners, ...wildCards];
    playoffTeams.forEach((team, index) => {
        team.seed = index + 1;
    });
    
    return playoffTeams;
}
