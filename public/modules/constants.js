// constants.js
// Central configuration and constant values for NFL Playoff Calculator

// ========================================
// API CONFIGURATION
// ========================================

export const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
export const SERVER_API_BASE = '/api'; // Local server endpoints

// ========================================
// NFL STRUCTURE
// ========================================

export const DIVISION_MAP = {
    // NFC North
    'CHI': 'NFC North', 
    'DET': 'NFC North', 
    'GB': 'NFC North', 
    'MIN': 'NFC North',
    
    // NFC South
    'ATL': 'NFC South', 
    'CAR': 'NFC South', 
    'NO': 'NFC South', 
    'TB': 'NFC South',
    
    // NFC East
    'DAL': 'NFC East', 
    'NYG': 'NFC East', 
    'PHI': 'NFC East', 
    'WAS': 'NFC East', 
    'WSH': 'NFC East',
    
    // NFC West
    'ARI': 'NFC West', 
    'LAR': 'NFC West', 
    'SF': 'NFC West', 
    'SEA': 'NFC West',
    
    // AFC North
    'BAL': 'AFC North', 
    'CIN': 'AFC North', 
    'CLE': 'AFC North', 
    'PIT': 'AFC North',
    
    // AFC South
    'HOU': 'AFC South', 
    'IND': 'AFC South', 
    'JAX': 'AFC South', 
    'JAC': 'AFC South', 
    'TEN': 'AFC South',
    
    // AFC East
    'BUF': 'AFC East', 
    'MIA': 'AFC East', 
    'NE': 'AFC East', 
    'NYJ': 'AFC East',
    
    // AFC West
    'DEN': 'AFC West', 
    'KC': 'AFC West', 
    'LV': 'AFC West', 
    'OAK': 'AFC West', 
    'LAC': 'AFC West'
};

// Helper to get conference from team abbreviation
export function getConference(teamAbbr) {
    const division = DIVISION_MAP[teamAbbr];
    if (!division) return null;
    return division.startsWith('NFC') ? 'NFC' : 'AFC';
}

// Helper to get division from team abbreviation
export function getDivision(teamAbbr) {
    return DIVISION_MAP[teamAbbr] || null;
}

// ========================================
// PLAYOFF STRUCTURE
// ========================================

export const PLAYOFF_SPOTS = {
    DIVISION_WINNERS: 4,
    WILD_CARDS: 3,
    TOTAL_PER_CONFERENCE: 7
};

export const REGULAR_SEASON_WEEKS = 18;

// ========================================
// SIMULATION SETTINGS
// ========================================

export const MONTE_CARLO_ITERATIONS = 1000;
export const HOME_FIELD_ADVANTAGE = 0.05; // 5% boost for home team in weighted simulation

// ========================================
// DEFAULT VALUES
// ========================================

export const DEFAULT_TARGET_TEAM = 'CHI';
export const FALLBACK_SEASON = 2025;
export const FALLBACK_WEEK = 14;
