// NFL Tiebreaker Logic Module
// Handles all tiebreaker calculations and multi-team tie resolution

// ========================================
// TIEBREAKER DATA STORAGE
// ========================================

let conferenceRecords = {}; // Team -> {wins, losses, ties, winPct} in conference games
let divisionRecords = {}; // Team -> {wins, losses, ties, winPct} in division games
let commonGamesRecords = {}; // "TEAM1_vs_TEAM2" -> {team, opponent, wins, losses, ties, winPct}
let headToHeadRecords = {}; // "TEAM1_vs_TEAM2" -> {team, opponent, wins, losses, ties, winPct}

// ========================================
// DATA FETCHING
// ========================================

async function fetchTiebreakRecords() {
    try {
        const season = 2025;
        
        // Fetch all tiebreaker data in parallel
        const [confResponse, divResponse, commonResponse, h2hResponse] = await Promise.all([
            fetch(`http://localhost:3000/api/conference-records/${season}`),
            fetch(`http://localhost:3000/api/division-records/${season}`),
            fetch(`http://localhost:3000/api/common-games/${season}`),
            fetch(`http://localhost:3000/api/head-to-head/${season}`)
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

// ========================================
// MULTI-TEAM TIEBREAKER RESOLUTION
// ========================================

function breakTieMultiTeam(tiedTeams, context = 'wildcard') {
    // Apply NFL tiebreaker rules to a group of teams with identical records
    // Returns teams sorted with the winner first
    
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

// ========================================
// SORTING COMPARISON FUNCTIONS
// ========================================

function createDivisionTiebreakSort() {
    // Returns a comparison function for sorting division teams with NFL tiebreakers
    return (a, b) => {
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
    };
}

function createConferenceTiebreakSort() {
    // Returns a comparison function for conference record tiebreakers (division winner seeding)
    return (a, b) => {
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
    };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        fetchTiebreakRecords,
        getTiebreakReason,
        breakTieMultiTeam,
        createDivisionTiebreakSort,
        createConferenceTiebreakSort,
        conferenceRecords,
        divisionRecords,
        commonGamesRecords,
        headToHeadRecords
    };
}
