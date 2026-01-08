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
