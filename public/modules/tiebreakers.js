// NFL Tiebreaker Logic Module
// Handles all tiebreaker calculations and multi-team tie resolution
// Reference: https://www.nfl.com/standings/tie-breaking-procedures

import { getCurrentSeason } from './state.js';
import { getDivision, getConference } from './constants.js';

// ========================================
// TIEBREAKER DATA STORAGE
// ========================================

export let conferenceRecords = {}; // Team -> {wins, losses, ties, winPct} in conference games
export let divisionRecords = {}; // Team -> {wins, losses, ties, winPct} in division games
export let commonGamesRecords = {}; // "TEAM1_vs_TEAM2" -> {team, opponent, wins, losses, ties, winPct}
export let headToHeadRecords = {}; // "TEAM1_vs_TEAM2" -> {team, opponent, wins, losses, ties, winPct}

// ========================================
// DATA FETCHING
// ========================================

export async function fetchTiebreakRecords() {
    try {
        const season = getCurrentSeason();
        
        // Fetch all tiebreaker data in parallel (using relative URLs)
        const [confResponse, divResponse, commonResponse, h2hResponse] = await Promise.all([
            fetch(`/api/conference-records/${season}`),
            fetch(`/api/division-records/${season}`),
            fetch(`/api/common-games/${season}`),
            fetch(`/api/head-to-head/${season}`)
        ]);
        
        conferenceRecords = await confResponse.json();
        divisionRecords = await divResponse.json();
        commonGamesRecords = await commonResponse.json();
        headToHeadRecords = await h2hResponse.json();
        
        console.log('Tiebreaker records loaded successfully');
    } catch (error) {
        console.error('Error fetching tiebreaker records:', error);
        throw error;
    }
}

// ========================================
// TIEBREAKER REASON GENERATION
// ========================================

export function getTiebreakReason(teamA, teamB, context = 'division') {
    // Returns the reason why teamA beats teamB (or null if no tiebreaker applies or teamB wins)
    // context: 'division' or 'wildcard'
    
    // Check if teams are actually tied
    if (teamA.wins !== teamB.wins || teamA.losses !== teamB.losses) {
        return null;
    }
    
    // For wildcard context, check if teams are from the same division
    // If so, use division tiebreaker rules instead
    if (context === 'wildcard') {
        const aDivision = teamA.division || getDivision(teamA.abbr);
        const bDivision = teamB.division || getDivision(teamB.abbr);
        if (aDivision === bDivision) {
            // Same division - use division tiebreakers
            context = 'division';
        }
    }
    
    if (context === 'division') {
        // Division tiebreakers - must check each step in order
        // If teamB wins at any step, return null (teamA doesn't beat teamB)
        
        // 1. Head-to-head
        const h2hKey = `${teamA.abbr}_vs_${teamB.abbr}`;
        const oppH2hKey = `${teamB.abbr}_vs_${teamA.abbr}`;
        if (headToHeadRecords[h2hKey] && headToHeadRecords[oppH2hKey]) {
            const h2hRec = headToHeadRecords[h2hKey];
            const oppRec = headToHeadRecords[oppH2hKey];
            if (h2hRec.wins + h2hRec.losses + h2hRec.ties > 0) {
                if (h2hRec.winPct > oppRec.winPct + 0.0001) {
                    return `Wins tie break over ${teamB.abbr} based on head-to-head (${h2hRec.wins}-${h2hRec.losses})`;
                } else if (oppRec.winPct > h2hRec.winPct + 0.0001) {
                    return null; // teamB wins this tiebreaker
                }
                // If tied, continue to next tiebreaker
            }
        }
        
        // 2. Division record
        if (divisionRecords[teamA.abbr] && divisionRecords[teamB.abbr]) {
            const aDiv = divisionRecords[teamA.abbr];
            const bDiv = divisionRecords[teamB.abbr];
            const aDivPct = (aDiv.wins + 0.5 * (aDiv.ties || 0)) / (aDiv.wins + aDiv.losses + (aDiv.ties || 0)) || 0;
            const bDivPct = (bDiv.wins + 0.5 * (bDiv.ties || 0)) / (bDiv.wins + bDiv.losses + (bDiv.ties || 0)) || 0;
            
            if (aDivPct > bDivPct + 0.0001) {
                return `Wins tie break over ${teamB.abbr} based on division record (${aDiv.wins}-${aDiv.losses} vs ${bDiv.wins}-${bDiv.losses})`;
            } else if (bDivPct > aDivPct + 0.0001) {
                return null; // teamB wins this tiebreaker
            }
            // If tied, continue to next tiebreaker
        }
        
        // 3. Common games
        const commonKey = `${teamA.abbr}_vs_${teamB.abbr}`;
        const oppCommonKey = `${teamB.abbr}_vs_${teamA.abbr}`;
        if (commonGamesRecords[commonKey] && commonGamesRecords[oppCommonKey]) {
            const aCommon = commonGamesRecords[commonKey];
            const bCommon = commonGamesRecords[oppCommonKey];
            if (aCommon.winPct > bCommon.winPct + 0.0001) {
                return `Wins tie break over ${teamB.abbr} based on common games (${aCommon.wins}-${aCommon.losses} vs ${bCommon.wins}-${bCommon.losses})`;
            } else if (bCommon.winPct > aCommon.winPct + 0.0001) {
                return null; // teamB wins this tiebreaker
            }
            // If tied, continue to next tiebreaker
        }
        
        // 4. Conference record
        if (conferenceRecords[teamA.abbr] && conferenceRecords[teamB.abbr]) {
            const aConf = conferenceRecords[teamA.abbr];
            const bConf = conferenceRecords[teamB.abbr];
            const aConfPct = (aConf.wins + 0.5 * (aConf.ties || 0)) / (aConf.wins + aConf.losses + (aConf.ties || 0)) || 0;
            const bConfPct = (bConf.wins + 0.5 * (bConf.ties || 0)) / (bConf.wins + bConf.losses + (bConf.ties || 0)) || 0;
            
            if (aConfPct > bConfPct + 0.0001) {
                return `Wins tie break over ${teamB.abbr} based on conference record (${aConf.wins}-${aConf.losses} vs ${bConf.wins}-${bConf.losses})`;
            } else if (bConfPct > aConfPct + 0.0001) {
                return null; // teamB wins this tiebreaker
            }
        }
    } else {
        // Wild card tiebreakers - check each step in order
        
        // 1. Head-to-head (if applicable)
        const h2hKey = `${teamA.abbr}_vs_${teamB.abbr}`;
        const oppH2hKey = `${teamB.abbr}_vs_${teamA.abbr}`;
        if (headToHeadRecords[h2hKey] && headToHeadRecords[oppH2hKey]) {
            const h2hRec = headToHeadRecords[h2hKey];
            const oppRec = headToHeadRecords[oppH2hKey];
            if (h2hRec.wins + h2hRec.losses + h2hRec.ties > 0) {
                if (h2hRec.winPct > oppRec.winPct + 0.0001) {
                    return `Wins tie break over ${teamB.abbr} based on head-to-head (${h2hRec.wins}-${h2hRec.losses})`;
                } else if (oppRec.winPct > h2hRec.winPct + 0.0001) {
                    return null; // teamB wins this tiebreaker
                }
            }
        }
        
        // 2. Conference record
        if (conferenceRecords[teamA.abbr] && conferenceRecords[teamB.abbr]) {
            const aConf = conferenceRecords[teamA.abbr];
            const bConf = conferenceRecords[teamB.abbr];
            const aConfPct = (aConf.wins + 0.5 * (aConf.ties || 0)) / (aConf.wins + aConf.losses + (aConf.ties || 0)) || 0;
            const bConfPct = (bConf.wins + 0.5 * (bConf.ties || 0)) / (bConf.wins + bConf.losses + (bConf.ties || 0)) || 0;
            
            if (aConfPct > bConfPct + 0.0001) {
                return `Wins tie break over ${teamB.abbr} based on conference record (${aConf.wins}-${aConf.losses} vs ${bConf.wins}-${bConf.losses})`;
            } else if (bConfPct > aConfPct + 0.0001) {
                return null; // teamB wins this tiebreaker
            }
        }
        
        // 3. Common games (minimum 4)
        const commonKey = `${teamA.abbr}_vs_${teamB.abbr}`;
        const oppCommonKey = `${teamB.abbr}_vs_${teamA.abbr}`;
        if (commonGamesRecords[commonKey] && commonGamesRecords[oppCommonKey]) {
            const aCommon = commonGamesRecords[commonKey];
            const bCommon = commonGamesRecords[oppCommonKey];
            const aGames = aCommon.wins + aCommon.losses + (aCommon.ties || 0);
            const bGames = bCommon.wins + bCommon.losses + (bCommon.ties || 0);
            
            if (aGames >= 4 && bGames >= 4) {
                if (aCommon.winPct > bCommon.winPct + 0.0001) {
                    return `Wins tie break over ${teamB.abbr} based on common games (${aCommon.wins}-${aCommon.losses} vs ${bCommon.wins}-${bCommon.losses})`;
                } else if (bCommon.winPct > aCommon.winPct + 0.0001) {
                    return null; // teamB wins this tiebreaker
                }
            }
        }
    }
    
    return null;
}

// ========================================
// MULTI-TEAM TIEBREAKER RESOLUTION
// ========================================

/**
 * Apply NFL multi-team tiebreaker rules to a group of teams with identical records
 * Returns teams sorted with the winner first
 * 
 * NFL Rules for 3+ clubs:
 * - Division: Apply 3+ club rules; if 2 remain, restart at step 1 of 2-club format
 * - Wild Card: First apply division tiebreaker to eliminate all but highest-ranked 
 *   club in each division, then apply steps 2+ of wild card rules
 */
export function breakTieMultiTeam(tiedTeams, context = 'wildcard') {
    if (tiedTeams.length <= 1) return tiedTeams;
    
    // Make a copy to avoid mutating the original
    let remaining = [...tiedTeams];
    const sorted = [];
    
    while (remaining.length > 0) {
        if (remaining.length === 1) {
            sorted.push(remaining[0]);
            break;
        }
        
        // If only 2 teams remain, use 2-club tiebreaker
        if (remaining.length === 2) {
            const sortFunc = context === 'division' 
                ? createDivisionTiebreakSort() 
                : createWildCardTiebreakSort();
            remaining.sort(sortFunc);
            
            // Add tiebreaker reason for the winner
            const winner = remaining[0];
            const loser = remaining[1];
            const reason = getTiebreakReason(winner, loser, context);
            if (reason && !winner.tiebreakReason) {
                winner.tiebreakReason = reason;
            }
            
            sorted.push(...remaining);
            break;
        }
        
        // 3+ teams tied
        let winner = null;
        let tiebreakReason = null;
        
        if (context === 'wildcard') {
            // Wild Card 3+ Clubs:
            // Step 1: Apply division tiebreaker to eliminate all but highest-ranked club in each division
            const teamsByDivision = {};
            for (const team of remaining) {
                const div = team.division || getDivision(team.abbr);
                if (!teamsByDivision[div]) {
                    teamsByDivision[div] = [];
                }
                teamsByDivision[div].push(team);
            }
            
            // For each division with multiple tied teams, keep only the top one
            const divisionWinners = [];
            for (const [div, teams] of Object.entries(teamsByDivision)) {
                if (teams.length === 1) {
                    divisionWinners.push(teams[0]);
                } else {
                    // Apply division tiebreaker to find the top team from this division
                    teams.sort(createDivisionTiebreakSort());
                    divisionWinners.push(teams[0]);
                }
            }
            
            // If we eliminated some teams, continue with reduced set
            if (divisionWinners.length < remaining.length) {
                remaining = divisionWinners;
                continue; // Restart with reduced set
            }
            
            // Step 2: Head-to-head sweep (one team beat all others or lost to all others)
            for (const team of remaining) {
                let beatAllOthers = true;
                let hasPlayedAll = true;
                
                for (const opponent of remaining) {
                    if (team.abbr === opponent.abbr) continue;
                    
                    const h2hKey = `${team.abbr}_vs_${opponent.abbr}`;
                    const h2hRec = headToHeadRecords[h2hKey];
                    
                    if (!h2hRec || h2hRec.wins + h2hRec.losses + h2hRec.ties === 0) {
                        hasPlayedAll = false;
                        beatAllOthers = false;
                        break;
                    }
                    
                    if (h2hRec.winPct <= 0.5) {
                        beatAllOthers = false;
                    }
                }
                
                if (hasPlayedAll && beatAllOthers) {
                    winner = team;
                    const otherTeams = remaining.filter(t => t.abbr !== team.abbr).map(t => t.abbr);
                    tiebreakReason = `Wins tie break over ${otherTeams.join(' and ')} based on head-to-head sweep`;
                    break;
                }
            }
            
            // Step 3: Conference record
            if (!winner) {
                let bestConfWinPct = -1;
                let bestTeam = null;
                
                for (const team of remaining) {
                    const confRec = conferenceRecords[team.abbr];
                    if (!confRec) continue;
                    
                    const winPct = calculateWinPct(confRec.wins, confRec.losses, confRec.ties);
                    if (winPct > bestConfWinPct) {
                        bestConfWinPct = winPct;
                        bestTeam = team;
                    }
                }
                
                if (bestTeam) {
                    // Check if this team is clearly better (no other team has same conf win pct)
                    const teamsWithSameConfWinPct = remaining.filter(t => {
                        const rec = conferenceRecords[t.abbr];
                        if (!rec) return false;
                        const pct = calculateWinPct(rec.wins, rec.losses, rec.ties);
                        return Math.abs(pct - bestConfWinPct) < 0.0001;
                    });
                    
                    if (teamsWithSameConfWinPct.length === 1) {
                        winner = bestTeam;
                        const confRec = conferenceRecords[bestTeam.abbr];
                        const otherTeams = remaining.filter(t => t.abbr !== bestTeam.abbr).map(t => t.abbr);
                        tiebreakReason = `Wins tie break over ${otherTeams.join(' and ')} based on conference record (${confRec.wins}-${confRec.losses})`;
                    }
                }
            }
            
            // Step 4: Common games (not implemented for 3+ teams - complex)
            
        } else {
            // Division 3+ Clubs tiebreaker
            // Step 1: Head-to-head (best win-pct in games among the tied clubs)
            // This requires calculating each team's record against ALL other tied teams combined
            const h2hAgainstTied = {};
            for (const team of remaining) {
                let wins = 0, losses = 0, ties = 0;
                for (const opponent of remaining) {
                    if (team.abbr === opponent.abbr) continue;
                    const h2hKey = `${team.abbr}_vs_${opponent.abbr}`;
                    const h2hRec = headToHeadRecords[h2hKey];
                    if (h2hRec) {
                        wins += h2hRec.wins;
                        losses += h2hRec.losses;
                        ties += h2hRec.ties;
                    }
                }
                h2hAgainstTied[team.abbr] = { wins, losses, ties, winPct: calculateWinPct(wins, losses, ties) };
            }
            
            // Find the team with best H2H record against other tied teams
            let bestH2HWinPct = -1;
            let bestH2HTeams = [];
            for (const team of remaining) {
                const rec = h2hAgainstTied[team.abbr];
                if (rec.wins + rec.losses + rec.ties > 0) {
                    if (rec.winPct > bestH2HWinPct + 0.0001) {
                        bestH2HWinPct = rec.winPct;
                        bestH2HTeams = [team];
                    } else if (Math.abs(rec.winPct - bestH2HWinPct) < 0.0001) {
                        bestH2HTeams.push(team);
                    }
                }
            }
            
            if (bestH2HTeams.length === 1) {
                winner = bestH2HTeams[0];
                const rec = h2hAgainstTied[winner.abbr];
                const otherTeams = remaining.filter(t => t.abbr !== winner.abbr).map(t => t.abbr);
                tiebreakReason = `Wins tie break over ${otherTeams.join(' and ')} based on head-to-head (${rec.wins}-${rec.losses})`;
            }
            
            // Step 2: Division record
            if (!winner) {
                let bestDivWinPct = -1;
                let bestTeam = null;
                
                for (const team of remaining) {
                    const divRec = divisionRecords[team.abbr];
                    if (!divRec) continue;
                    
                    const winPct = calculateWinPct(divRec.wins, divRec.losses, divRec.ties);
                    if (winPct > bestDivWinPct + 0.0001) {
                        bestDivWinPct = winPct;
                        bestTeam = team;
                    }
                }
                
                if (bestTeam) {
                    const teamsWithSameDivWinPct = remaining.filter(t => {
                        const rec = divisionRecords[t.abbr];
                        if (!rec) return false;
                        const pct = calculateWinPct(rec.wins, rec.losses, rec.ties);
                        return Math.abs(pct - bestDivWinPct) < 0.0001;
                    });
                    
                    if (teamsWithSameDivWinPct.length === 1) {
                        winner = bestTeam;
                        const divRec = divisionRecords[bestTeam.abbr];
                        const otherTeams = remaining.filter(t => t.abbr !== bestTeam.abbr).map(t => t.abbr);
                        tiebreakReason = `Wins tie break over ${otherTeams.join(' and ')} based on division record (${divRec.wins}-${divRec.losses})`;
                    }
                }
            }
            
            // Step 3: Common games (not fully implemented for 3+ teams)
            
            // Step 4: Conference record  
            if (!winner) {
                let bestConfWinPct = -1;
                let bestTeam = null;
                
                for (const team of remaining) {
                    const confRec = conferenceRecords[team.abbr];
                    if (!confRec) continue;
                    
                    const winPct = calculateWinPct(confRec.wins, confRec.losses, confRec.ties);
                    if (winPct > bestConfWinPct + 0.0001) {
                        bestConfWinPct = winPct;
                        bestTeam = team;
                    }
                }
                
                if (bestTeam) {
                    const teamsWithSameConfWinPct = remaining.filter(t => {
                        const rec = conferenceRecords[t.abbr];
                        if (!rec) return false;
                        const pct = calculateWinPct(rec.wins, rec.losses, rec.ties);
                        return Math.abs(pct - bestConfWinPct) < 0.0001;
                    });
                    
                    if (teamsWithSameConfWinPct.length === 1) {
                        winner = bestTeam;
                        const confRec = conferenceRecords[bestTeam.abbr];
                        const otherTeams = remaining.filter(t => t.abbr !== bestTeam.abbr).map(t => t.abbr);
                        tiebreakReason = `Wins tie break over ${otherTeams.join(' and ')} based on conference record (${confRec.wins}-${confRec.losses})`;
                    }
                }
            }
        }
        
        // If we found a winner, add them and remove from remaining
        if (winner) {
            winner.tiebreakReason = tiebreakReason;
            sorted.push(winner);
            remaining = remaining.filter(t => t.abbr !== winner.abbr);
        } else {
            // No clear tiebreaker found - this shouldn't happen with proper implementation
            // but fall back to first team and continue
            console.warn('No tiebreaker could resolve tie between:', remaining.map(t => t.abbr));
            sorted.push(remaining[0]);
            remaining = remaining.slice(1);
        }
    }
    
    return sorted;
}

/**
 * Helper to calculate win percentage from W-L-T
 */
function calculateWinPct(wins, losses, ties = 0) {
    const totalGames = wins + losses + ties;
    if (totalGames === 0) return 0;
    return (wins + 0.5 * ties) / totalGames;
}

// ========================================
// SORTING COMPARISON FUNCTIONS
// ========================================

/**
 * Compare two teams' records at a specific level (division, conference, etc.)
 * Returns: negative if a is better, positive if b is better, 0 if tied
 */
function compareRecords(aRec, bRec) {
    if (!aRec || !bRec) return 0;
    
    const aWinPct = calculateWinPct(aRec.wins, aRec.losses, aRec.ties);
    const bWinPct = calculateWinPct(bRec.wins, bRec.losses, bRec.ties);
    
    if (Math.abs(aWinPct - bWinPct) > 0.0001) {
        return bWinPct - aWinPct; // Higher win pct is better (negative = a is better)
    }
    return 0;
}

export function createDivisionTiebreakSort() {
    // Returns a comparison function for sorting division teams with NFL tiebreakers
    // NFL Division Tiebreakers (Two Clubs):
    // 1. Head-to-head
    // 2. Division record  
    // 3. Common games
    // 4. Conference record
    // 5. Strength of victory (not implemented)
    // 6. Strength of schedule (not implemented)
    // 7-12. Various point differential metrics (not implemented)
    
    return (a, b) => {
        // 0. First compare overall win percentage
        const aWinPct = a.winPct || 0;
        const bWinPct = b.winPct || 0;
        if (Math.abs(bWinPct - aWinPct) > 0.0001) {
            return bWinPct - aWinPct;
        }
        
        // Teams have same win percentage - apply NFL division tiebreakers
        
        // 1. Head-to-head record
        const h2hKeyA = `${a.abbr}_vs_${b.abbr}`;
        const h2hKeyB = `${b.abbr}_vs_${a.abbr}`;
        if (headToHeadRecords[h2hKeyA] && headToHeadRecords[h2hKeyB]) {
            const aH2H = headToHeadRecords[h2hKeyA];
            const bH2H = headToHeadRecords[h2hKeyB];
            
            // Only use H2H if they've actually played
            if (aH2H.wins + aH2H.losses + aH2H.ties > 0) {
                const result = compareRecords(aH2H, bH2H);
                if (result !== 0) return result;
            }
        }
        
        // 2. Division record
        if (divisionRecords[a.abbr] && divisionRecords[b.abbr]) {
            const result = compareRecords(divisionRecords[a.abbr], divisionRecords[b.abbr]);
            if (result !== 0) return result;
        }
        
        // 3. Common games record
        const commonKeyA = `${a.abbr}_vs_${b.abbr}`;
        const commonKeyB = `${b.abbr}_vs_${a.abbr}`;
        if (commonGamesRecords[commonKeyA] && commonGamesRecords[commonKeyB]) {
            const result = compareRecords(commonGamesRecords[commonKeyA], commonGamesRecords[commonKeyB]);
            if (result !== 0) return result;
        }
        
        // 4. Conference record
        if (conferenceRecords[a.abbr] && conferenceRecords[b.abbr]) {
            const result = compareRecords(conferenceRecords[a.abbr], conferenceRecords[b.abbr]);
            if (result !== 0) return result;
        }
        
        // 5+ Strength of victory, schedule, point differential - not implemented
        // Return 0 (maintain current order) if all implemented tiebreakers are tied
        return 0;
    };
}

export function createWildCardTiebreakSort() {
    // Returns a comparison function for wild card tiebreakers between teams from DIFFERENT divisions
    // NFL Wild Card Tiebreakers (Two Clubs from different divisions):
    // 1. Head-to-head, if applicable
    // 2. Conference record
    // 3. Common games, minimum of four
    // 4. Strength of victory (not implemented)
    // 5. Strength of schedule (not implemented)
    // 6-11. Various point differential metrics (not implemented)
    
    return (a, b) => {
        // 0. First compare overall win percentage
        const aWinPct = a.winPct || 0;
        const bWinPct = b.winPct || 0;
        if (Math.abs(bWinPct - aWinPct) > 0.0001) {
            return bWinPct - aWinPct;
        }
        
        // Check if teams are from the same division - if so, use division tiebreaker
        const aDivision = a.division || getDivision(a.abbr);
        const bDivision = b.division || getDivision(b.abbr);
        
        if (aDivision === bDivision) {
            // Same division - use division tiebreakers
            return createDivisionTiebreakSort()(a, b);
        }
        
        // Teams from different divisions - apply wild card tiebreakers
        
        // 1. Head-to-head, if applicable (only if they've played)
        const h2hKeyA = `${a.abbr}_vs_${b.abbr}`;
        const h2hKeyB = `${b.abbr}_vs_${a.abbr}`;
        if (headToHeadRecords[h2hKeyA] && headToHeadRecords[h2hKeyB]) {
            const aH2H = headToHeadRecords[h2hKeyA];
            const bH2H = headToHeadRecords[h2hKeyB];
            
            // Only use H2H if they've actually played
            if (aH2H.wins + aH2H.losses + aH2H.ties > 0) {
                const result = compareRecords(aH2H, bH2H);
                if (result !== 0) return result;
            }
        }
        
        // 2. Conference record
        if (conferenceRecords[a.abbr] && conferenceRecords[b.abbr]) {
            const result = compareRecords(conferenceRecords[a.abbr], conferenceRecords[b.abbr]);
            if (result !== 0) return result;
        }
        
        // 3. Common games (minimum of four) - for wild card, common games come AFTER conference record
        const commonKeyA = `${a.abbr}_vs_${b.abbr}`;
        const commonKeyB = `${b.abbr}_vs_${a.abbr}`;
        if (commonGamesRecords[commonKeyA] && commonGamesRecords[commonKeyB]) {
            const aCommon = commonGamesRecords[commonKeyA];
            const bCommon = commonGamesRecords[commonKeyB];
            
            // Only use common games if both teams have played at least 4 common games
            const aGames = aCommon.wins + aCommon.losses + aCommon.ties;
            const bGames = bCommon.wins + bCommon.losses + bCommon.ties;
            
            if (aGames >= 4 && bGames >= 4) {
                const result = compareRecords(aCommon, bCommon);
                if (result !== 0) return result;
            }
        }
        
        // 4+ Strength of victory, schedule, point differential - not implemented
        return 0;
    };
}

export function createConferenceTiebreakSort() {
    // Returns a comparison function for division winner seeding (seeds 1-4)
    // Per NFL rules: "To determine home-field priority among division winners, apply Wild Card tiebreakers"
    // So this should use wild card tiebreaker order:
    // 1. Head-to-head, if applicable
    // 2. Conference record
    // 3. Common games, minimum of four
    // etc.
    
    return (a, b) => {
        // 0. First compare overall win percentage
        const aWinPct = a.winPct || 0;
        const bWinPct = b.winPct || 0;
        if (Math.abs(bWinPct - aWinPct) > 0.0001) {
            return bWinPct - aWinPct;
        }
        
        // Division winners are always from different divisions, so use wild card rules
        
        // 1. Head-to-head, if applicable
        const h2hKeyA = `${a.abbr}_vs_${b.abbr}`;
        const h2hKeyB = `${b.abbr}_vs_${a.abbr}`;
        if (headToHeadRecords[h2hKeyA] && headToHeadRecords[h2hKeyB]) {
            const aH2H = headToHeadRecords[h2hKeyA];
            const bH2H = headToHeadRecords[h2hKeyB];
            
            if (aH2H.wins + aH2H.losses + aH2H.ties > 0) {
                const result = compareRecords(aH2H, bH2H);
                if (result !== 0) return result;
            }
        }
        
        // 2. Conference record
        if (conferenceRecords[a.abbr] && conferenceRecords[b.abbr]) {
            const result = compareRecords(conferenceRecords[a.abbr], conferenceRecords[b.abbr]);
            if (result !== 0) return result;
        }
        
        // 3. Common games (minimum of four)
        const commonKeyA = `${a.abbr}_vs_${b.abbr}`;
        const commonKeyB = `${b.abbr}_vs_${a.abbr}`;
        if (commonGamesRecords[commonKeyA] && commonGamesRecords[commonKeyB]) {
            const aCommon = commonGamesRecords[commonKeyA];
            const bCommon = commonGamesRecords[commonKeyB];
            
            const aGames = aCommon.wins + aCommon.losses + aCommon.ties;
            const bGames = bCommon.wins + bCommon.losses + bCommon.ties;
            
            if (aGames >= 4 && bGames >= 4) {
                const result = compareRecords(aCommon, bCommon);
                if (result !== 0) return result;
            }
        }
        
        // 4+ Not implemented
        return 0;
    };
}

// All exports are now using ES6 export syntax above
