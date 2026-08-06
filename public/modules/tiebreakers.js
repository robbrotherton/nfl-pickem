// NFL Tiebreaker Logic Module
// Handles all tiebreaker calculations and multi-team tie resolution
// Reference: https://www.nfl.com/standings/tie-breaking-procedures

import { getCurrentSeason, getCurrentWeek } from './state.js';
import { getDivision, getConference } from './constants.js';

// ========================================
// TIEBREAKER DATA STORAGE
// ========================================

export let conferenceRecords = {}; // Team -> {wins, losses, ties, winPct} in conference games
export let divisionRecords = {}; // Team -> {wins, losses, ties, winPct} in division games
export let commonGamesRecords = {}; // "TEAM1_vs_TEAM2" -> {team, opponent, wins, losses, ties, winPct}
export let headToHeadRecords = {}; // "TEAM1_vs_TEAM2" -> {team, opponent, wins, losses, ties, winPct}
export let teamGames = {}; // Team -> [{opponent, result}]
export let teamRecords = {}; // Team -> {wins, losses, ties, winPct}
export let strengthRecords = {}; // Team -> {sov, sos}

export function snapshotTiebreakRecords() {
    return {
        conferenceRecords,
        divisionRecords,
        commonGamesRecords,
        headToHeadRecords,
        teamGames,
        teamRecords,
        strengthRecords
    };
}

export function setTiebreakRecords(records) {
    conferenceRecords = records?.conferenceRecords || {};
    divisionRecords = records?.divisionRecords || {};
    commonGamesRecords = records?.commonGamesRecords || {};
    headToHeadRecords = records?.headToHeadRecords || {};
    teamGames = records?.teamGames || {};
    teamRecords = records?.teamRecords || {};
    strengthRecords = records?.strengthRecords || {};
}

// ========================================
// DATA FETCHING
// ========================================

export async function fetchTiebreakRecords() {
    try {
        const season = getCurrentSeason();
        
        // Fetch all tiebreaker data in parallel (using relative URLs)
        const [confResponse, divResponse, commonResponse, h2hResponse, gamesResponse] = await Promise.all([
            fetch(`/api/conference-records/${season}`),
            fetch(`/api/division-records/${season}`),
            fetch(`/api/common-games/${season}`),
            fetch(`/api/head-to-head/${season}`),
            fetch(`/api/games/${season}?season_type=2`)
        ]);
        
        conferenceRecords = await confResponse.json();
        divisionRecords = await divResponse.json();
        commonGamesRecords = await commonResponse.json();
        headToHeadRecords = await h2hResponse.json();
        const games = await gamesResponse.json();
        const finalGames = Array.isArray(games) ? games.filter(g => g.status === 'final') : [];
        buildTeamGameData(finalGames);
        warnIfMissingRegularSeasonWeeks(finalGames);
        
        console.log('Tiebreaker records loaded successfully');
    } catch (error) {
        console.error('Error fetching tiebreaker records:', error);
        throw error;
    }
}

function buildTeamGameData(games) {
    const records = buildTiebreakRecordsFromGames(games);
    setTiebreakRecords(records);
}

function ensureTeamRecord(teamAbbr) {
    if (!teamRecords[teamAbbr]) {
        teamRecords[teamAbbr] = { wins: 0, losses: 0, ties: 0, winPct: 0 };
    }
}

function ensureTeamGames(teamAbbr) {
    if (!teamGames[teamAbbr]) {
        teamGames[teamAbbr] = [];
    }
}

function getWinnerAbbrFromGame(game) {
    const result = getGameResult(game);
    if (result === 'away') return getTeamAbbr(game, 'away');
    if (result === 'home') return getTeamAbbr(game, 'home');
    return null;
}

function getTeamAbbr(game, side) {
    if (side === 'away') {
        return game.away_abbr || game.awayTeam?.abbr || game.awayTeam?.id || null;
    }
    return game.home_abbr || game.homeTeam?.abbr || game.homeTeam?.id || null;
}

function getGameResult(game) {
    if (game?.result === 'home' || game?.result === 'away' || game?.result === 'tie') {
        return game.result;
    }
    const awayScore = Number.isFinite(game.away_score) ? game.away_score
        : (Number.isFinite(game.awayScore) ? game.awayScore : null);
    const homeScore = Number.isFinite(game.home_score) ? game.home_score
        : (Number.isFinite(game.homeScore) ? game.homeScore : null);
    if (awayScore === null || homeScore === null) return null;
    if (awayScore > homeScore) return 'away';
    if (homeScore > awayScore) return 'home';
    return 'tie';
}

function buildStrengthRecords(games, teamRecordsOverride) {
    const workingTeamRecords = teamRecordsOverride || teamRecords;
    const sums = {};
    Object.keys(workingTeamRecords).forEach(team => {
        sums[team] = {
            sovWins: 0, sovLosses: 0, sovTies: 0,
            sosWins: 0, sosLosses: 0, sosTies: 0
        };
    });

    games.forEach(game => {
        const away = getTeamAbbr(game, 'away');
        const home = getTeamAbbr(game, 'home');
        if (!away || !home) return;
        const awayRec = workingTeamRecords[away];
        const homeRec = workingTeamRecords[home];
        if (!awayRec || !homeRec) return;

        addOpponentRecord(sums[away], homeRec, 'sos');
        addOpponentRecord(sums[home], awayRec, 'sos');

        const winner = getWinnerAbbrFromGame(game);
        if (winner === away) {
            addOpponentRecord(sums[away], homeRec, 'sov');
        } else if (winner === home) {
            addOpponentRecord(sums[home], awayRec, 'sov');
        }
    });

    const result = {};
    Object.entries(sums).forEach(([team, rec]) => {
        const sov = calculateWinPct(rec.sovWins, rec.sovLosses, rec.sovTies);
        const sos = calculateWinPct(rec.sosWins, rec.sosLosses, rec.sosTies);
        result[team] = { sov, sos };
    });
    return result;
}

export function buildTiebreakRecordsFromGames(games) {
    const records = {
        conferenceRecords: {},
        divisionRecords: {},
        commonGamesRecords: {},
        headToHeadRecords: {},
        teamGames: {},
        teamRecords: {},
        strengthRecords: {}
    };

    if (!Array.isArray(games)) {
        return records;
    }

    const ensureRecord = (map, team, opponent = null) => {
        if (!map[team]) {
            map[team] = {
                team,
                opponent,
                wins: 0,
                losses: 0,
                ties: 0,
                winPct: 0
            };
        }
    };

    const ensureTeamRecord = team => {
        if (!records.teamRecords[team]) {
            records.teamRecords[team] = { wins: 0, losses: 0, ties: 0, winPct: 0 };
        }
    };

    const ensureTeamGames = team => {
        if (!records.teamGames[team]) {
            records.teamGames[team] = [];
        }
    };

    const applyResult = (rec, result) => {
        if (result === 'win') rec.wins += 1;
        else if (result === 'loss') rec.losses += 1;
        else rec.ties += 1;
    };

    const updateHeadToHead = (team, opponent, result) => {
        const key = `${team}_vs_${opponent}`;
        if (!records.headToHeadRecords[key]) {
            records.headToHeadRecords[key] = { team, opponent, wins: 0, losses: 0, ties: 0, winPct: 0 };
        }
        applyResult(records.headToHeadRecords[key], result);
    };

    games.forEach(game => {
        const away = getTeamAbbr(game, 'away');
        const home = getTeamAbbr(game, 'home');
        if (!away || !home) return;

        const result = getGameResult(game);
        if (!result) return;

        ensureTeamRecord(away);
        ensureTeamRecord(home);
        ensureTeamGames(away);
        ensureTeamGames(home);

        if (result === 'away') {
            applyResult(records.teamRecords[away], 'win');
            applyResult(records.teamRecords[home], 'loss');
            records.teamGames[away].push({ opponent: home, result: 'win' });
            records.teamGames[home].push({ opponent: away, result: 'loss' });
            updateHeadToHead(away, home, 'win');
            updateHeadToHead(home, away, 'loss');
        } else if (result === 'home') {
            applyResult(records.teamRecords[home], 'win');
            applyResult(records.teamRecords[away], 'loss');
            records.teamGames[home].push({ opponent: away, result: 'win' });
            records.teamGames[away].push({ opponent: home, result: 'loss' });
            updateHeadToHead(home, away, 'win');
            updateHeadToHead(away, home, 'loss');
        } else {
            applyResult(records.teamRecords[home], 'tie');
            applyResult(records.teamRecords[away], 'tie');
            records.teamGames[home].push({ opponent: away, result: 'tie' });
            records.teamGames[away].push({ opponent: home, result: 'tie' });
            updateHeadToHead(home, away, 'tie');
            updateHeadToHead(away, home, 'tie');
        }

        const awayConf = getConference(away);
        const homeConf = getConference(home);
        if (awayConf && homeConf && awayConf === homeConf) {
            ensureRecord(records.conferenceRecords, away);
            ensureRecord(records.conferenceRecords, home);
            if (result === 'away') {
                applyResult(records.conferenceRecords[away], 'win');
                applyResult(records.conferenceRecords[home], 'loss');
            } else if (result === 'home') {
                applyResult(records.conferenceRecords[home], 'win');
                applyResult(records.conferenceRecords[away], 'loss');
            } else {
                applyResult(records.conferenceRecords[home], 'tie');
                applyResult(records.conferenceRecords[away], 'tie');
            }
        }

        const awayDiv = getDivision(away);
        const homeDiv = getDivision(home);
        if (awayDiv && homeDiv && awayDiv === homeDiv) {
            ensureRecord(records.divisionRecords, away);
            ensureRecord(records.divisionRecords, home);
            if (result === 'away') {
                applyResult(records.divisionRecords[away], 'win');
                applyResult(records.divisionRecords[home], 'loss');
            } else if (result === 'home') {
                applyResult(records.divisionRecords[home], 'win');
                applyResult(records.divisionRecords[away], 'loss');
            } else {
                applyResult(records.divisionRecords[home], 'tie');
                applyResult(records.divisionRecords[away], 'tie');
            }
        }
    });

    Object.values(records.teamRecords).forEach(rec => {
        rec.winPct = calculateWinPct(rec.wins, rec.losses, rec.ties);
    });
    Object.values(records.conferenceRecords).forEach(rec => {
        rec.winPct = calculateWinPct(rec.wins, rec.losses, rec.ties);
    });
    Object.values(records.divisionRecords).forEach(rec => {
        rec.winPct = calculateWinPct(rec.wins, rec.losses, rec.ties);
    });
    Object.values(records.headToHeadRecords).forEach(rec => {
        rec.winPct = calculateWinPct(rec.wins, rec.losses, rec.ties);
    });

    records.strengthRecords = buildStrengthRecords(games, records.teamRecords);
    records.commonGamesRecords = buildCommonGamesRecords(records.teamGames);

    return records;
}

function buildCommonGamesRecords(teamGamesData) {
    const commonRecords = {};
    const teams = Object.keys(teamGamesData);
    const opponentSets = new Map();

    teams.forEach(team => {
        const opponents = new Set();
        (teamGamesData[team] || []).forEach(game => {
            opponents.add(game.opponent);
        });
        opponentSets.set(team, opponents);
    });

    teams.forEach(team => {
        const games = teamGamesData[team] || [];
        teams.forEach(opponent => {
            if (team === opponent) return;
            const commonOpponents = new Set();
            const teamOpponents = opponentSets.get(team) || new Set();
            const oppOpponents = opponentSets.get(opponent) || new Set();
            teamOpponents.forEach(opp => {
                if (oppOpponents.has(opp)) commonOpponents.add(opp);
            });

            let wins = 0;
            let losses = 0;
            let ties = 0;
            games.forEach(game => {
                if (!commonOpponents.has(game.opponent)) return;
                if (game.result === 'win') wins += 1;
                else if (game.result === 'loss') losses += 1;
                else ties += 1;
            });
            const total = wins + losses + ties;
            commonRecords[`${team}_vs_${opponent}`] = {
                team,
                opponent,
                wins,
                losses,
                ties,
                winPct: total > 0 ? calculateWinPct(wins, losses, ties) : 0
            };
        });
    });

    return commonRecords;
}

function addOpponentRecord(target, opponentRec, type) {
    const winsKey = `${type}Wins`;
    const lossesKey = `${type}Losses`;
    const tiesKey = `${type}Ties`;
    target[winsKey] += opponentRec.wins || 0;
    target[lossesKey] += opponentRec.losses || 0;
    target[tiesKey] += opponentRec.ties || 0;
}

function warnIfMissingRegularSeasonWeeks(games) {
    if (!Array.isArray(games) || games.length === 0) return;
    const currentWeek = getCurrentWeek() || 0;
    if (currentWeek <= 0) return;

    const weeksWithGames = new Set(games.map(game => game.week).filter(week => Number.isInteger(week)));
    const missing = [];
    for (let week = 1; week <= currentWeek; week++) {
        if (!weeksWithGames.has(week)) missing.push(week);
    }
    if (missing.length > 0) {
        console.warn(`⚠️ Missing regular season weeks in DB (season ${getCurrentSeason()}): ${missing.join(', ')}`);
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

        // 5. Strength of victory
        const aStrength = strengthRecords[teamA.abbr];
        const bStrength = strengthRecords[teamB.abbr];
        if (aStrength && bStrength) {
            if (aStrength.sov > bStrength.sov + 0.0001) {
                return `Wins tie break over ${teamB.abbr} based on strength of victory`;
            } else if (bStrength.sov > aStrength.sov + 0.0001) {
                return null; // teamB wins this tiebreaker
            }
        }

        // 6. Strength of schedule
        if (aStrength && bStrength) {
            if (aStrength.sos > bStrength.sos + 0.0001) {
                return `Wins tie break over ${teamB.abbr} based on strength of schedule`;
            } else if (bStrength.sos > aStrength.sos + 0.0001) {
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

        // 4. Strength of victory
        const aStrength = strengthRecords[teamA.abbr];
        const bStrength = strengthRecords[teamB.abbr];
        if (aStrength && bStrength) {
            if (aStrength.sov > bStrength.sov + 0.0001) {
                return `Wins tie break over ${teamB.abbr} based on strength of victory`;
            } else if (bStrength.sov > aStrength.sov + 0.0001) {
                return null; // teamB wins this tiebreaker
            }
        }

        // 5. Strength of schedule
        if (aStrength && bStrength) {
            if (aStrength.sos > bStrength.sos + 0.0001) {
                return `Wins tie break over ${teamB.abbr} based on strength of schedule`;
            } else if (bStrength.sos > aStrength.sos + 0.0001) {
                return null; // teamB wins this tiebreaker
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

    if (context === 'wildcard') {
        return rankWildCardTeams(tiedTeams);
    }

    return rankDivisionTeams(tiedTeams);
}

function rankWildCardTeams(tiedTeams) {
    let remaining = [...tiedTeams];
    const sorted = [];

    while (remaining.length > 0) {
        if (remaining.length === 1) {
            sorted.push(remaining[0]);
            break;
        }

        const divisionFinalists = selectDivisionFinalists(remaining);
        const winner = selectMultiTeamWinner(divisionFinalists, 'wildcard');

        if (!winner) {
            console.warn('No wildcard tiebreaker winner found, falling back to first team.');
            sorted.push(remaining[0]);
            remaining = remaining.slice(1);
            continue;
        }

        sorted.push(winner);
        remaining = remaining.filter(t => t.abbr !== winner.abbr);
    }

    return sorted;
}

function rankDivisionTeams(tiedTeams) {
    let remaining = [...tiedTeams];
    const sorted = [];

    while (remaining.length > 0) {
        if (remaining.length === 1) {
            sorted.push(remaining[0]);
            break;
        }

        const winner = selectMultiTeamWinner(remaining, 'division');

        if (!winner) {
            console.warn('No division tiebreaker winner found, falling back to first team.');
            sorted.push(remaining[0]);
            remaining = remaining.slice(1);
            continue;
        }

        sorted.push(winner);
        remaining = remaining.filter(t => t.abbr !== winner.abbr);
    }

    return sorted;
}

function selectDivisionFinalists(teams) {
    const teamsByDivision = {};
    for (const team of teams) {
        const div = team.division || getDivision(team.abbr);
        if (!teamsByDivision[div]) {
            teamsByDivision[div] = [];
        }
        teamsByDivision[div].push(team);
    }

    const finalists = [];
    for (const divisionTeams of Object.values(teamsByDivision)) {
        if (divisionTeams.length === 1) {
            finalists.push(divisionTeams[0]);
        } else {
            divisionTeams.sort(createDivisionTiebreakSort());
            finalists.push(divisionTeams[0]);
        }
    }

    return finalists;
}

function selectMultiTeamWinner(teams, context) {
    if (teams.length === 1) return teams[0];

    if (teams.length === 2) {
        const sorter = context === 'division'
            ? createDivisionTiebreakSort()
            : createWildCardTiebreakSort();
        const ordered = [...teams].sort(sorter);
        const winner = ordered[0];
        const loser = ordered[1];
        const reason = getTiebreakReason(winner, loser, context);
        if (reason && !winner.tiebreakReason) {
            winner.tiebreakReason = reason;
        }
        return winner;
    }

    let remaining = [...teams];
    const steps = context === 'division'
        ? [
            stepDivisionHeadToHead,
            stepDivisionRecord,
            stepCommonGames,
            stepConferenceRecord,
            stepStrengthOfVictory,
            stepStrengthOfSchedule
        ]
        : [
            stepWildcardHeadToHeadSweep,
            stepConferenceRecord,
            stepCommonGames,
            stepStrengthOfVictory,
            stepStrengthOfSchedule
        ];

    while (remaining.length > 1) {
        let reduced = false;
        for (const step of steps) {
            const outcome = step(remaining, context);
            if (!outcome) continue;

            if (outcome.type === 'winner') {
                if (outcome.reason && !outcome.winner.tiebreakReason) {
                    outcome.winner.tiebreakReason = outcome.reason;
                }
                return outcome.winner;
            }

            if (outcome.type === 'reduce') {
                remaining = outcome.teams;
                reduced = true;
                break;
            }

            if (outcome.type === 'eliminate') {
                remaining = remaining.filter(t => !outcome.eliminate.has(t.abbr));
                reduced = true;
                break;
            }
        }

        if (!reduced) break;
    }

    if (remaining.length === 1) return remaining[0];

    const sorter = context === 'division'
        ? createDivisionTiebreakSort()
        : createWildCardTiebreakSort();
    remaining.sort(sorter);
    return remaining[0];
}

function stepWildcardHeadToHeadSweep(teams) {
    let winner = null;
    let reason = null;
    const eliminations = new Set();

    for (const team of teams) {
        const record = getGroupHeadToHeadRecord(team, teams);
        if (!record.hasPlayedAll || record.games === 0) {
            continue;
        }

        if (record.winPct >= 0.9999) {
            winner = team;
            const otherTeams = teams.filter(t => t.abbr !== team.abbr).map(t => t.abbr);
            reason = `Wins tie break over ${otherTeams.join(' and ')} based on head-to-head sweep`;
            break;
        }

        if (record.winPct <= 0.0001) {
            eliminations.add(team.abbr);
        }
    }

    if (winner) {
        return { type: 'winner', winner, reason };
    }

    if (eliminations.size > 0) {
        return { type: 'eliminate', eliminate: eliminations };
    }

    return null;
}

function stepDivisionHeadToHead(teams) {
    return reduceByMetric(
        teams,
        team => {
            const rec = getGroupHeadToHeadRecord(team, teams);
            return rec.games > 0 ? rec.winPct : null;
        },
        (winner, others) => `Wins tie break over ${others.join(' and ')} based on head-to-head`
    );
}

function stepDivisionRecord(teams) {
    return reduceByMetric(
        teams,
        team => {
            const rec = divisionRecords[team.abbr];
            return rec ? calculateWinPct(rec.wins, rec.losses, rec.ties) : null;
        },
        (winner, others) => `Wins tie break over ${others.join(' and ')} based on division record`
    );
}

function stepConferenceRecord(teams) {
    return reduceByMetric(
        teams,
        team => {
            const rec = conferenceRecords[team.abbr];
            return rec ? calculateWinPct(rec.wins, rec.losses, rec.ties) : null;
        },
        (winner, others) => `Wins tie break over ${others.join(' and ')} based on conference record`
    );
}

function stepCommonGames(teams) {
    const records = teams.map(team => getMultiTeamCommonRecord(team, teams));
    if (records.some(rec => !rec || rec.games < 4)) {
        return null;
    }

    const recordMap = new Map();
    records.forEach((rec, idx) => {
        recordMap.set(teams[idx].abbr, rec);
    });

    return reduceByMetric(
        teams,
        team => recordMap.get(team.abbr)?.winPct ?? null,
        (winner, others) => `Wins tie break over ${others.join(' and ')} based on common games`
    );
}

function stepStrengthOfVictory(teams) {
    return reduceByMetric(
        teams,
        team => strengthRecords[team.abbr]?.sov ?? null,
        (winner, others) => `Wins tie break over ${others.join(' and ')} based on strength of victory`
    );
}

function stepStrengthOfSchedule(teams) {
    return reduceByMetric(
        teams,
        team => strengthRecords[team.abbr]?.sos ?? null,
        (winner, others) => `Wins tie break over ${others.join(' and ')} based on strength of schedule`
    );
}

function reduceByMetric(teams, metricFn, reasonFn) {
    let bestValue = null;
    let bestTeams = [];

    for (const team of teams) {
        const value = metricFn(team);
        if (value === null || Number.isNaN(value)) continue;
        if (bestValue === null || value > bestValue + 0.0001) {
            bestValue = value;
            bestTeams = [team];
        } else if (Math.abs(value - bestValue) < 0.0001) {
            bestTeams.push(team);
        }
    }

    if (bestTeams.length === 0) return null;
    if (bestTeams.length === teams.length) return null;

    if (bestTeams.length === 1) {
        const winner = bestTeams[0];
        const others = teams.filter(t => t.abbr !== winner.abbr).map(t => t.abbr);
        return { type: 'winner', winner, reason: reasonFn(winner, others) };
    }

    return { type: 'reduce', teams: bestTeams };
}

function getGroupHeadToHeadRecord(team, group) {
    let wins = 0;
    let losses = 0;
    let ties = 0;
    let hasPlayedAll = true;

    for (const opponent of group) {
        if (team.abbr === opponent.abbr) continue;
        const key = `${team.abbr}_vs_${opponent.abbr}`;
        const rec = headToHeadRecords[key];
        if (!rec || rec.wins + rec.losses + rec.ties === 0) {
            hasPlayedAll = false;
            continue;
        }
        wins += rec.wins;
        losses += rec.losses;
        ties += rec.ties;
    }

    const games = wins + losses + ties;
    return {
        wins,
        losses,
        ties,
        games,
        winPct: games > 0 ? calculateWinPct(wins, losses, ties) : 0,
        hasPlayedAll
    };
}

function getMultiTeamCommonRecord(team, tiedTeams) {
    const commonOpponents = getCommonOpponents(tiedTeams);
    if (commonOpponents.length === 0) return null;

    const opponentSet = new Set(commonOpponents);
    const games = teamGames[team.abbr] || [];
    let wins = 0;
    let losses = 0;
    let ties = 0;

    games.forEach(game => {
        if (!opponentSet.has(game.opponent)) return;
        if (game.result === 'win') wins += 1;
        else if (game.result === 'loss') losses += 1;
        else ties += 1;
    });

    const total = wins + losses + ties;
    return {
        wins,
        losses,
        ties,
        games: total,
        winPct: total > 0 ? calculateWinPct(wins, losses, ties) : 0
    };
}

function getCommonOpponents(tiedTeams) {
    const tiedSet = new Set(tiedTeams.map(t => t.abbr));
    const opponentSets = tiedTeams.map(team => {
        const opponents = new Set();
        (teamGames[team.abbr] || []).forEach(game => {
            if (!tiedSet.has(game.opponent)) {
                opponents.add(game.opponent);
            }
        });
        return opponents;
    });

    if (opponentSets.length === 0) return [];
    let common = opponentSets[0];
    opponentSets.slice(1).forEach(set => {
        common = new Set([...common].filter(opp => set.has(opp)));
    });

    return [...common];
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
    // 5. Strength of victory
    // 6. Strength of schedule
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

        // 5. Strength of victory
        if (strengthRecords[a.abbr] && strengthRecords[b.abbr]) {
            const aSov = strengthRecords[a.abbr].sov || 0;
            const bSov = strengthRecords[b.abbr].sov || 0;
            if (Math.abs(bSov - aSov) > 0.0001) {
                return bSov - aSov;
            }
        }

        // 6. Strength of schedule
        if (strengthRecords[a.abbr] && strengthRecords[b.abbr]) {
            const aSos = strengthRecords[a.abbr].sos || 0;
            const bSos = strengthRecords[b.abbr].sos || 0;
            if (Math.abs(bSos - aSos) > 0.0001) {
                return bSos - aSos;
            }
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
    // 4. Strength of victory
    // 5. Strength of schedule
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

        // 4. Strength of victory
        if (strengthRecords[a.abbr] && strengthRecords[b.abbr]) {
            const aSov = strengthRecords[a.abbr].sov || 0;
            const bSov = strengthRecords[b.abbr].sov || 0;
            if (Math.abs(bSov - aSov) > 0.0001) {
                return bSov - aSov;
            }
        }

        // 5. Strength of schedule
        if (strengthRecords[a.abbr] && strengthRecords[b.abbr]) {
            const aSos = strengthRecords[a.abbr].sos || 0;
            const bSos = strengthRecords[b.abbr].sos || 0;
            if (Math.abs(bSos - aSos) > 0.0001) {
                return bSos - aSos;
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

        // 4. Strength of victory
        if (strengthRecords[a.abbr] && strengthRecords[b.abbr]) {
            const aSov = strengthRecords[a.abbr].sov || 0;
            const bSov = strengthRecords[b.abbr].sov || 0;
            if (Math.abs(bSov - aSov) > 0.0001) {
                return bSov - aSov;
            }
        }

        // 5. Strength of schedule
        if (strengthRecords[a.abbr] && strengthRecords[b.abbr]) {
            const aSos = strengthRecords[a.abbr].sos || 0;
            const bSos = strengthRecords[b.abbr].sos || 0;
            if (Math.abs(bSos - aSos) > 0.0001) {
                return bSos - aSos;
            }
        }
        
    // 6+ Not implemented
        return 0;
    };
}

// All exports are now using ES6 export syntax above
