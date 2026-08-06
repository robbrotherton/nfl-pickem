// api.js
// All API calls to ESPN and local server

import { ESPN_API_BASE, ESPN_CORE_API_BASE, DIVISION_MAP, REGULAR_SEASON_WEEKS, FALLBACK_SEASON, FALLBACK_WEEK } from './constants.js';
import { getCurrentSeason, getCurrentWeek, setCurrentSeason, setCurrentWeek } from './state.js';

// ========================================
// ESPN API CALLS
// ========================================

/**
 * Fetch current season and week information from ESPN scoreboard
 * Sets the values in state
 * 
 * Note: For the playoff calculator, we always use regular season (seasontype=2) standings.
 * If we're in the playoffs (seasontype=3), we should use week 18 standings.
 */
export async function fetchCurrentSeasonInfo() {
    try {
        const response = await fetch(`${ESPN_API_BASE}/scoreboard`);
        const data = await response.json();
        
        if (data.season && data.week) {
            const seasonYear = data.season.year;
            const seasonType = data.season.type; // 1=preseason, 2=regular, 3=postseason
            const weekNumber = data.week.number;
            
            setCurrentSeason(seasonYear);
            
            // If we're in the playoffs (seasontype 3) or offseason, use week 18 (final regular season week)
            // This ensures the playoff calculator shows final regular season standings
            if (seasonType === 3 || seasonType === 4) {
                setCurrentWeek(REGULAR_SEASON_WEEKS);
                console.log(`📅 Current Season: ${seasonYear}, Playoffs Week ${weekNumber} - Using regular season Week ${REGULAR_SEASON_WEEKS} for standings`);
            } else if (seasonType === 2) {
                // Regular season - use current week (capped at 18)
                setCurrentWeek(Math.min(weekNumber, REGULAR_SEASON_WEEKS));
                console.log(`📅 Current Season: ${seasonYear}, Week: ${weekNumber}`);
            } else {
                // Preseason (type 1) - use fallback
                setCurrentSeason(FALLBACK_SEASON);
                setCurrentWeek(FALLBACK_WEEK);
                console.warn('⚠️ Preseason detected, using fallback season/week values');
            }
        } else {
            // Fallback to defaults if API doesn't provide
            setCurrentSeason(FALLBACK_SEASON);
            setCurrentWeek(FALLBACK_WEEK);
            console.warn('⚠️ Using fallback season/week values');
        }
    } catch (error) {
        console.error('Error fetching season info:', error);
        setCurrentSeason(FALLBACK_SEASON);
        setCurrentWeek(FALLBACK_WEEK);
    }
}

/**
 * Fetch clinching status from ESPN Core API
 * Returns a map of team abbreviation -> clincher status
 */
export async function fetchClincherStatus() {
    const currentSeason = getCurrentSeason();
    const clincherMap = {};
    
    // Fetch both AFC (group 8) and NFC (group 7) standings for clincher status only
    for (const { conference, groupId } of [{ conference: 'AFC', groupId: 8 }, { conference: 'NFC', groupId: 7 }]) {
        try {
            const response = await fetch(
                `${ESPN_CORE_API_BASE}/seasons/${currentSeason}/types/2/groups/${groupId}/standings/0?lang=en&region=us`,
                { 
                    mode: 'cors',
                    headers: {
                        'Accept': 'application/json'
                    }
                }
            );
            
            if (!response.ok) {
                console.warn(`Failed to fetch ${conference} clincher status: ${response.status}`);
                continue;
            }
            
            const data = await response.json();
            
            if (data.standings) {
                for (const teamData of data.standings) {
                    // Get team abbreviation from the team ref URL
                    const teamRef = teamData.team?.$ref;
                    if (!teamRef) continue;
                    
                    // Extract team ID from ref and fetch just to get abbreviation
                    const teamId = teamRef.split('/').pop().split('?')[0];
                    const teamResponse = await fetch(teamRef);
                    const team = await teamResponse.json();
                    
                    // Get clincher status
                    const record = teamData.records?.[0];
                    const stats = record?.stats || [];
                    const clincher = stats.find(s => s.name === 'clincher')?.displayValue || '';
                    
                    clincherMap[team.abbreviation] = clincher; // 'z' = div, 'y' = playoff, 'e' = eliminated, '' = competing
                }
            }
        } catch (error) {
            console.warn(`Error fetching ${conference} clincher status (continuing without it):`, error.message);
        }
    }
    
    if (Object.keys(clincherMap).length > 0) {
        console.log(`✓ Loaded clincher status for ${Object.keys(clincherMap).length} teams`);
    } else {
        console.warn('⚠️ Could not fetch clincher status from ESPN Core API - continuing without clinch indicators');
    }
    return clincherMap;
}

/**
 * Fetch all team standings from ESPN scoreboard
 * Builds standings from completed games in weeks 1 through current week
 */
export async function fetchStandings() {
    const teamMap = new Map();
    const currentSeason = getCurrentSeason();
    const currentWeek = getCurrentWeek();
    
    // Fetch all weeks so far to build current standings
    for (let week = 1; week <= currentWeek; week++) {
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
    
    // Fetch clincher status and add to teams
    const clincherMap = await fetchClincherStatus();
    
    // Add division, conference, and clincher info to each team
    const standings = Array.from(teamMap.values())
        .map(team => ({
            ...team,
            division: DIVISION_MAP[team.abbr] || 'Unknown',
            conference: DIVISION_MAP[team.abbr]?.startsWith('NFC') ? 'NFC' : 'AFC',
            clincher: clincherMap[team.abbr] || '' // Add ESPN's clincher status
        }));
    
    // Sort by win percentage (descending)
    standings.sort((a, b) => {
        if (b.winPct !== a.winPct) return b.winPct - a.winPct;
        return 0;
    });
    
    console.log(`✓ Loaded ${standings.length} teams with records and clincher status`);
    
    return standings;
}

/**
 * Fetch all remaining games (from current week through week 18)
 */
export async function fetchRemainingGames() {
    const games = [];
    const currentWeek = getCurrentWeek();
    
    // Fetch remaining weeks (current week + future weeks through week 18)
    for (let week = currentWeek; week <= REGULAR_SEASON_WEEKS; week++) {
        const response = await fetch(`${ESPN_API_BASE}/scoreboard?seasontype=2&week=${week}`);
        const data = await response.json();
        
        if (data.events) {
            data.events.forEach(event => {
                const competition = event.competitions[0];
                const homeTeam = competition.competitors.find(t => t.homeAway === 'home');
                const awayTeam = competition.competitors.find(t => t.homeAway === 'away');
                
                // Normalize ESPN status values into canonical statuses:
                // 'final', 'in_progress', 'scheduled'
                const compStatus = competition.status?.type || {};
                const state = compStatus.state;
                const completed = compStatus.completed || false;
                let status;
                if (completed || state === 'post' || state === 'closed' || state === 'final') {
                    status = 'final';
                } else if (state === 'in' || state === 'in_progress' || state === 'live') {
                    status = 'in_progress';
                } else {
                    status = 'scheduled';
                }

                // Only include non-final games for remaining-games list
                if (status !== 'final') {
                    games.push({
                        id: event.id,
                        week: week,
                        date: new Date(event.date),
                        status,
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
    
    return games;
}

/**
 * Fetch regular-season games from DB and build standings + remaining games without ESPN.
 * Sets current season/week in state.
 */
export async function fetchDbSeasonData() {
    const season = await resolveSeasonFromDb();
    if (!season) {
        throw new Error('No seasons found in DB.');
    }

    setCurrentSeason(season);

    const gamesResponse = await fetch(`/api/games/${season}?season_type=2`);
    const games = await gamesResponse.json();
    const currentWeek = deriveCurrentWeekFromGames(games);
    setCurrentWeek(currentWeek);

    const standings = buildStandingsFromDbGames(games);
    const allGames = buildAllGamesFromDbGames(games);
    const remainingGames = buildRemainingGamesFromDbGames(games, currentWeek);

    return { season, currentWeek, games, standings, allGames, remainingGames };
}

async function resolveSeasonFromDb() {
    const currentSeason = getCurrentSeason();
    if (currentSeason) return currentSeason;
    const seasonsResponse = await fetch('/api/seasons');
    const seasons = await seasonsResponse.json();
    return Array.isArray(seasons) && seasons.length > 0 ? seasons[0] : null;
}

function deriveCurrentWeekFromGames(games) {
    if (!Array.isArray(games) || games.length === 0) return 1;
    const now = Date.now();
    let maxWeek = 0;
    games.forEach(game => {
        const gameTime = Date.parse(game.game_date);
        if (!Number.isNaN(gameTime) && gameTime <= now) {
            if (Number.isInteger(game.week) && game.week > maxWeek) {
                maxWeek = game.week;
            }
        }
    });
    return maxWeek > 0 ? maxWeek : 1;
}

function buildStandingsFromDbGames(games) {
    const teamMap = new Map();
    if (!Array.isArray(games)) return [];
    games.forEach(game => {
        if (game.status !== 'final') return;
        const awayAbbr = game.away_abbr;
        const homeAbbr = game.home_abbr;
        if (!awayAbbr || !homeAbbr) return;

        const awayScore = Number.isFinite(game.away_score) ? game.away_score : null;
        const homeScore = Number.isFinite(game.home_score) ? game.home_score : null;

        let awayResult = 'tie';
        let homeResult = 'tie';
        if (awayScore !== null && homeScore !== null) {
            if (awayScore > homeScore) {
                awayResult = 'win';
                homeResult = 'loss';
            } else if (homeScore > awayScore) {
                awayResult = 'loss';
                homeResult = 'win';
            }
        }

        const awayTeam = ensureTeam(teamMap, awayAbbr, game.away_team, game.away_logo);
        const homeTeam = ensureTeam(teamMap, homeAbbr, game.home_team, game.home_logo);

        applyResult(awayTeam, awayResult);
        applyResult(homeTeam, homeResult);
    });

    const standings = Array.from(teamMap.values()).map(team => {
        const winPct = (team.wins + 0.5 * team.ties) / (team.wins + team.losses + team.ties || 1);
        return {
            ...team,
            winPct,
            season: getCurrentSeason(),
            division: DIVISION_MAP[team.abbr] || 'Unknown',
            conference: DIVISION_MAP[team.abbr]?.startsWith('NFC') ? 'NFC' : 'AFC',
            clincher: ''
        };
    });

    standings.sort((a, b) => {
        if (b.winPct !== a.winPct) return b.winPct - a.winPct;
        return 0;
    });

    return standings;
}

function ensureTeam(teamMap, abbr, name, logo) {
    if (!teamMap.has(abbr)) {
        teamMap.set(abbr, {
            id: abbr,
            name: name || abbr,
            abbr,
            logo: logo || '',
            wins: 0,
            losses: 0,
            ties: 0
        });
    }
    return teamMap.get(abbr);
}

function applyResult(team, result) {
    if (result === 'win') team.wins += 1;
    else if (result === 'loss') team.losses += 1;
    else team.ties += 1;
}

function buildRemainingGamesFromDbGames(games, currentWeek) {
    if (!Array.isArray(games)) return [];
    return games
        .filter(game => game.status !== 'final' && game.week >= currentWeek)
        .map(game => ({
            id: game.id,
            week: game.week,
            date: new Date(game.game_date),
            status: game.status,
            homeTeam: {
                id: game.home_abbr,
                abbr: game.home_abbr,
                name: game.home_team,
                logo: game.home_logo,
                record: game.home_record || '0-0'
            },
            awayTeam: {
                id: game.away_abbr,
                abbr: game.away_abbr,
                name: game.away_team,
                logo: game.away_logo,
                record: game.away_record || '0-0'
            }
        }));
}

function buildAllGamesFromDbGames(games) {
    if (!Array.isArray(games)) return [];
    return games.map(game => ({
        id: game.id,
        week: game.week,
        date: new Date(game.game_date),
        status: game.status,
        home_score: Number.isFinite(game.home_score) ? game.home_score : null,
        away_score: Number.isFinite(game.away_score) ? game.away_score : null,
        homeTeam: {
            id: game.home_abbr,
            abbr: game.home_abbr,
            name: game.home_team,
            logo: game.home_logo,
            record: game.home_record || '0-0'
        },
        awayTeam: {
            id: game.away_abbr,
            abbr: game.away_abbr,
            name: game.away_team,
            logo: game.away_logo,
            record: game.away_record || '0-0'
        }
    }));
}
