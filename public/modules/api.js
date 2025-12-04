// api.js
// All API calls to ESPN and local server

import { ESPN_API_BASE, DIVISION_MAP, REGULAR_SEASON_WEEKS, FALLBACK_SEASON, FALLBACK_WEEK } from './constants.js';
import { getCurrentSeason, getCurrentWeek, setCurrentSeason, setCurrentWeek } from './state.js';

// ========================================
// ESPN API CALLS
// ========================================

/**
 * Fetch current season and week information from ESPN scoreboard
 * Sets the values in state
 */
export async function fetchCurrentSeasonInfo() {
    try {
        const response = await fetch(`${ESPN_API_BASE}/scoreboard`);
        const data = await response.json();
        
        if (data.season && data.week) {
            setCurrentSeason(data.season.year);
            setCurrentWeek(data.week.number);
            console.log(`📅 Current Season: ${data.season.year}, Week: ${data.week.number}`);
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
 * Fetch all team standings from ESPN
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
    
    // Add division and conference info to each team
    const standings = Array.from(teamMap.values())
        .map(team => ({
            ...team,
            division: DIVISION_MAP[team.abbr] || 'Unknown',
            conference: DIVISION_MAP[team.abbr]?.startsWith('NFC') ? 'NFC' : 'AFC'
        }));
    
    // Sort by win percentage (descending)
    standings.sort((a, b) => {
        if (b.winPct !== a.winPct) return b.winPct - a.winPct;
        return 0;
    });
    
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
                
                // Only include games that haven't been played yet
                const status = competition.status.type.state;
                if (status === 'pre') {
                    games.push({
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
    
    return games;
}
