// NFL Pick'em Server
// Simple Express + SQLite backend for home network

const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('nfl-pickem.db');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize database tables
db.exec(`
    CREATE TABLE IF NOT EXISTS players (
        name TEXT PRIMARY KEY,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS week_players (
        season INTEGER,
        week INTEGER,
        player_name TEXT,
        display_order INTEGER,
        PRIMARY KEY (season, week, player_name)
    );

    CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        season INTEGER,
        week INTEGER,
        game_date TEXT,
        away_team TEXT,
        home_team TEXT,
        away_abbr TEXT,
        home_abbr TEXT,
        away_logo TEXT,
        home_logo TEXT,
        away_wordmark TEXT,
        home_wordmark TEXT,
        away_record TEXT,
        home_record TEXT,
        away_score INTEGER,
        home_score INTEGER,
        winner TEXT,
        status TEXT,
        last_updated TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS picks (
        player_name TEXT,
        game_id TEXT,
        season INTEGER,
        week INTEGER,
        picked_team TEXT,
        is_correct INTEGER,
        picked_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (player_name, game_id)
    );

    CREATE INDEX IF NOT EXISTS idx_games_week ON games(season, week);
    CREATE INDEX IF NOT EXISTS idx_picks_week ON picks(season, week);
    CREATE INDEX IF NOT EXISTS idx_picks_player ON picks(player_name, season);
`);

// Migrate existing games table to add wordmark columns if they don't exist
try {
    db.exec(`
        ALTER TABLE games ADD COLUMN away_wordmark TEXT;
    `);
} catch (e) {
    // Column already exists, ignore
}

try {
    db.exec(`
        ALTER TABLE games ADD COLUMN home_wordmark TEXT;
    `);
} catch (e) {
    // Column already exists, ignore
}

// ========================================
// API ENDPOINTS
// ========================================

// Get all players
app.get('/api/players', (req, res) => {
    try {
        const players = db.prepare('SELECT * FROM players ORDER BY name').all();
        res.json(players);
    } catch (error) {
        console.error('Error fetching players:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get available seasons (years that have games in the database)
app.get('/api/seasons', (req, res) => {
    try {
        const seasons = db.prepare(
            'SELECT DISTINCT season FROM games ORDER BY season DESC'
        ).all();
        res.json(seasons.map(s => s.season));
    } catch (error) {
        console.error('Error fetching seasons:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get players for a specific week
app.get('/api/week-players/:season/:week', (req, res) => {
    try {
        const { season, week } = req.params;
        const players = db.prepare(
            'SELECT * FROM week_players WHERE season = ? AND week = ? ORDER BY display_order'
        ).all(season, week);
        res.json(players);
    } catch (error) {
        console.error('Error fetching week players:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add player to a week
app.post('/api/week-players', (req, res) => {
    try {
        const { season, week, player_name, display_order } = req.body;
        
        // Add to players table if not exists
        db.prepare('INSERT OR IGNORE INTO players (name) VALUES (?)').run(player_name);
        
        // Add to week_players
        db.prepare(
            'INSERT OR REPLACE INTO week_players (season, week, player_name, display_order) VALUES (?, ?, ?, ?)'
        ).run(season, week, player_name, display_order);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding week player:', error);
        res.status(500).json({ error: error.message });
    }
});

// Remove player from a week
app.delete('/api/week-players/:season/:week/:player', (req, res) => {
    try {
        const { season, week, player } = req.params;
        db.prepare(
            'DELETE FROM week_players WHERE season = ? AND week = ? AND player_name = ?'
        ).run(season, week, decodeURIComponent(player));
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing week player:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get games for a week
app.get('/api/games/:season/:week', (req, res) => {
    try {
        const { season, week } = req.params;
        const games = db.prepare(
            'SELECT * FROM games WHERE season = ? AND week = ? ORDER BY game_date, home_team'
        ).all(season, week);
        res.json(games);
    } catch (error) {
        console.error('Error fetching games:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save/update game
app.post('/api/games', (req, res) => {
    try {
        const { id, season, week, game_date, away_team, home_team, away_abbr, home_abbr, 
                away_logo, home_logo, away_wordmark, home_wordmark, away_record, home_record, away_score, home_score, winner, status } = req.body;
        
        db.prepare(`
            INSERT OR REPLACE INTO games 
            (id, season, week, game_date, away_team, home_team, away_abbr, home_abbr, 
             away_logo, home_logo, away_wordmark, home_wordmark, away_record, home_record, away_score, home_score, winner, status, last_updated) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, season, week, game_date, away_team, home_team, away_abbr, home_abbr, 
               away_logo, home_logo, away_wordmark, home_wordmark, away_record, home_record, away_score, home_score, winner, status);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving game:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete games for a week (for refresh)
app.delete('/api/games/:season/:week', (req, res) => {
    try {
        const { season, week } = req.params;
        db.prepare('DELETE FROM games WHERE season = ? AND week = ?').run(season, week);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting games:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all games for a specific team in a season
app.get('/api/games/:season/team/:teamName', (req, res) => {
    try {
        const { season, teamName } = req.params;
        const decodedTeamName = decodeURIComponent(teamName);
        
        const games = db.prepare(`
            SELECT * FROM games 
            WHERE season = ? AND (away_team = ? OR home_team = ?)
            ORDER BY week ASC
        `).all(season, decodedTeamName, decodedTeamName);
        
        res.json(games);
    } catch (error) {
        console.error('Error fetching team games:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete a pick (for deselecting) - MUST be before GET /api/picks/:season/:week
app.delete('/api/picks/:player/:gameId', (req, res) => {
    try {
        const { player, gameId } = req.params;
        db.prepare(
            'DELETE FROM picks WHERE player_name = ? AND game_id = ?'
        ).run(decodeURIComponent(player), gameId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting pick:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get picks for a week
app.get('/api/picks/:season/:week', (req, res) => {
    try {
        const { season, week } = req.params;
        const picks = db.prepare(
            'SELECT * FROM picks WHERE season = ? AND week = ?'
        ).all(season, week);
        res.json(picks);
    } catch (error) {
        console.error('Error fetching picks:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save a pick
app.post('/api/picks', (req, res) => {
    try {
        const { player_name, game_id, season, week, picked_team } = req.body;
        
        db.prepare(`
            INSERT OR REPLACE INTO picks 
            (player_name, game_id, season, week, picked_team, is_correct, picked_at) 
            VALUES (?, ?, ?, ?, ?, NULL, datetime('now'))
        `).run(player_name, game_id, season, week, picked_team);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving pick:', error);
        res.status(500).json({ error: error.message });
    }
});

// Score picks for a game
app.post('/api/score-picks', (req, res) => {
    try {
        const { game_id, winner } = req.body;
        
        db.prepare(
            'UPDATE picks SET is_correct = (picked_team = ?) WHERE game_id = ? AND is_correct IS NULL'
        ).run(winner, game_id);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error scoring picks:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get leaderboard for season
app.get('/api/leaderboard/:season', (req, res) => {
    try {
        const { season } = req.params;
        
        const standings = db.prepare(`
            SELECT 
                player_name,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as losses,
                COUNT(DISTINCT week) as weeks_played
            FROM picks
            WHERE season = ? AND is_correct IS NOT NULL
            GROUP BY player_name
            ORDER BY 
                CAST(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS FLOAT) / 
                NULLIF(COUNT(*), 0) DESC,
                wins DESC
        `).all(season);
        
        res.json(standings);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get leaderboard for specific week
app.get('/api/leaderboard/:season/:week', (req, res) => {
    try {
        const { season, week } = req.params;
        
        const standings = db.prepare(`
            SELECT 
                player_name,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as losses
            FROM picks
            WHERE season = ? AND week = ? AND is_correct IS NOT NULL
            GROUP BY player_name
            ORDER BY 
                CAST(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS FLOAT) / 
                NULLIF(COUNT(*), 0) DESC,
                wins DESC
        `).all(season, week);
        
        res.json(standings);
    } catch (error) {
        console.error('Error fetching week leaderboard:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// PLAYOFF CALCULATOR ENDPOINTS
// ========================================

// Team division/conference mapping
// Map full team names to abbreviations
const TEAM_NAME_TO_ABBR = {
    'Arizona Cardinals': 'ARI',
    'Atlanta Falcons': 'ATL',
    'Baltimore Ravens': 'BAL',
    'Buffalo Bills': 'BUF',
    'Carolina Panthers': 'CAR',
    'Chicago Bears': 'CHI',
    'Cincinnati Bengals': 'CIN',
    'Cleveland Browns': 'CLE',
    'Dallas Cowboys': 'DAL',
    'Denver Broncos': 'DEN',
    'Detroit Lions': 'DET',
    'Green Bay Packers': 'GB',
    'Houston Texans': 'HOU',
    'Indianapolis Colts': 'IND',
    'Jacksonville Jaguars': 'JAX',
    'Kansas City Chiefs': 'KC',
    'Las Vegas Raiders': 'LV',
    'Los Angeles Chargers': 'LAC',
    'Los Angeles Rams': 'LAR',
    'Miami Dolphins': 'MIA',
    'Minnesota Vikings': 'MIN',
    'New England Patriots': 'NE',
    'New Orleans Saints': 'NO',
    'New York Giants': 'NYG',
    'New York Jets': 'NYJ',
    'Philadelphia Eagles': 'PHI',
    'Pittsburgh Steelers': 'PIT',
    'San Francisco 49ers': 'SF',
    'Seattle Seahawks': 'SEA',
    'Tampa Bay Buccaneers': 'TB',
    'Tennessee Titans': 'TEN',
    'Washington Commanders': 'WAS'
};

const TEAM_INFO = {
    // NFC East
    'PHI': { conference: 'NFC', division: 'NFC East' },
    'DAL': { conference: 'NFC', division: 'NFC East' },
    'NYG': { conference: 'NFC', division: 'NFC East' },
    'WAS': { conference: 'NFC', division: 'NFC East' },
    // NFC North
    'DET': { conference: 'NFC', division: 'NFC North' },
    'MIN': { conference: 'NFC', division: 'NFC North' },
    'GB': { conference: 'NFC', division: 'NFC North' },
    'CHI': { conference: 'NFC', division: 'NFC North' },
    // NFC South
    'TB': { conference: 'NFC', division: 'NFC South' },
    'ATL': { conference: 'NFC', division: 'NFC South' },
    'NO': { conference: 'NFC', division: 'NFC South' },
    'CAR': { conference: 'NFC', division: 'NFC South' },
    // NFC West
    'SEA': { conference: 'NFC', division: 'NFC West' },
    'LAR': { conference: 'NFC', division: 'NFC West' },
    'SF': { conference: 'NFC', division: 'NFC West' },
    'ARI': { conference: 'NFC', division: 'NFC West' },
    // AFC East
    'BUF': { conference: 'AFC', division: 'AFC East' },
    'MIA': { conference: 'AFC', division: 'AFC East' },
    'NYJ': { conference: 'AFC', division: 'AFC East' },
    'NE': { conference: 'AFC', division: 'AFC East' },
    // AFC North
    'PIT': { conference: 'AFC', division: 'AFC North' },
    'BAL': { conference: 'AFC', division: 'AFC North' },
    'CIN': { conference: 'AFC', division: 'AFC North' },
    'CLE': { conference: 'AFC', division: 'AFC North' },
    // AFC South
    'HOU': { conference: 'AFC', division: 'AFC South' },
    'IND': { conference: 'AFC', division: 'AFC South' },
    'JAX': { conference: 'AFC', division: 'AFC South' },
    'JAC': { conference: 'AFC', division: 'AFC South' }, // Alternate abbreviation
    'TEN': { conference: 'AFC', division: 'AFC South' },
    // AFC West
    'KC': { conference: 'AFC', division: 'AFC West' },
    'LAC': { conference: 'AFC', division: 'AFC West' },
    'DEN': { conference: 'AFC', division: 'AFC West' },
    'LV': { conference: 'AFC', division: 'AFC West' },
    'OAK': { conference: 'AFC', division: 'AFC West' } // Legacy abbreviation
};

// Get conference records for all teams
app.get('/api/conference-records/:season', (req, res) => {
    try {
        const { season } = req.params;
        
        // Get all completed games for the season
        const games = db.prepare(`
            SELECT away_abbr, home_abbr, winner 
            FROM games 
            WHERE season = ? AND status = 'final' AND winner IS NOT NULL
        `).all(season);
        
        // Initialize records for each team
        const records = {};
        Object.keys(TEAM_INFO).forEach(abbr => {
            records[abbr] = { wins: 0, losses: 0, ties: 0 };
        });
        
        // Count conference games
        games.forEach(game => {
            const awayTeam = TEAM_INFO[game.away_abbr];
            const homeTeam = TEAM_INFO[game.home_abbr];
            
            if (!awayTeam || !homeTeam) return;
            
            // Only count if both teams are in the same conference
            if (awayTeam.conference === homeTeam.conference) {
                const winnerAbbr = TEAM_NAME_TO_ABBR[game.winner];
                
                if (winnerAbbr === game.away_abbr) {
                    records[game.away_abbr].wins++;
                    records[game.home_abbr].losses++;
                } else if (winnerAbbr === game.home_abbr) {
                    records[game.home_abbr].wins++;
                    records[game.away_abbr].losses++;
                } else if (!winnerAbbr) {
                    // Tie (no winner)
                    records[game.away_abbr].ties++;
                    records[game.home_abbr].ties++;
                }
            }
        });
        
        res.json(records);
    } catch (error) {
        console.error('Error calculating conference records:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get division records for all teams
app.get('/api/division-records/:season', (req, res) => {
    try {
        const { season } = req.params;
        
        // Get all completed games for the season
        const games = db.prepare(`
            SELECT away_abbr, home_abbr, winner 
            FROM games 
            WHERE season = ? AND status = 'final' AND winner IS NOT NULL
        `).all(season);
        
        // Initialize records for each team
        const records = {};
        Object.keys(TEAM_INFO).forEach(abbr => {
            records[abbr] = { wins: 0, losses: 0, ties: 0 };
        });
        
        // Count division games
        games.forEach(game => {
            const awayTeam = TEAM_INFO[game.away_abbr];
            const homeTeam = TEAM_INFO[game.home_abbr];
            
            if (!awayTeam || !homeTeam) return;
            
            // Only count if both teams are in the same division
            if (awayTeam.division === homeTeam.division) {
                const winnerAbbr = TEAM_NAME_TO_ABBR[game.winner];
                
                if (winnerAbbr === game.away_abbr) {
                    records[game.away_abbr].wins++;
                    records[game.home_abbr].losses++;
                } else if (winnerAbbr === game.home_abbr) {
                    records[game.home_abbr].wins++;
                    records[game.away_abbr].losses++;
                } else if (!winnerAbbr) {
                    // Tie (no winner)
                    records[game.away_abbr].ties++;
                    records[game.home_abbr].ties++;
                }
            }
        });
        
        res.json(records);
    } catch (error) {
        console.error('Error calculating division records:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get common games records for all teams
// Common games = games against opponents that both teams played
app.get('/api/common-games/:season', (req, res) => {
    try {
        const { season } = req.params;
        
        // Get all completed games for the season
        const games = db.prepare(`
            SELECT away_abbr, home_abbr, winner 
            FROM games 
            WHERE season = ? AND status = 'final' AND winner IS NOT NULL
        `).all(season);
        
        // For each pair of teams in the same division, calculate common games record
        const records = {};
        
        // Group teams by division
        const divisionTeams = {};
        Object.entries(TEAM_INFO).forEach(([abbr, info]) => {
            if (!divisionTeams[info.division]) {
                divisionTeams[info.division] = [];
            }
            divisionTeams[info.division].push(abbr);
        });
        
        // For each division, calculate common games for all pairs
        Object.values(divisionTeams).forEach(teams => {
            teams.forEach(team1 => {
                teams.forEach(team2 => {
                    if (team1 >= team2) return; // Only calculate once per pair
                    
                    // Find common opponents
                    const team1Opponents = new Set();
                    const team2Opponents = new Set();
                    
                    games.forEach(game => {
                        if (game.away_abbr === team1) team1Opponents.add(game.home_abbr);
                        if (game.home_abbr === team1) team1Opponents.add(game.away_abbr);
                        if (game.away_abbr === team2) team2Opponents.add(game.home_abbr);
                        if (game.home_abbr === team2) team2Opponents.add(game.away_abbr);
                    });
                    
                    const commonOpponents = [...team1Opponents].filter(opp => 
                        team2Opponents.has(opp) && opp !== team1 && opp !== team2
                    );
                    
                    if (commonOpponents.length === 0) return;
                    
                    // Calculate records against common opponents
                    let team1Wins = 0, team1Losses = 0, team1Ties = 0;
                    let team2Wins = 0, team2Losses = 0, team2Ties = 0;
                    
                    games.forEach(game => {
                        const winnerAbbr = TEAM_NAME_TO_ABBR[game.winner];
                        
                        // Team 1's games vs common opponents
                        if (commonOpponents.includes(game.away_abbr) && game.home_abbr === team1) {
                            if (winnerAbbr === team1) team1Wins++;
                            else if (winnerAbbr === game.away_abbr) team1Losses++;
                            else team1Ties++;
                        }
                        if (commonOpponents.includes(game.home_abbr) && game.away_abbr === team1) {
                            if (winnerAbbr === team1) team1Wins++;
                            else if (winnerAbbr === game.home_abbr) team1Losses++;
                            else team1Ties++;
                        }
                        
                        // Team 2's games vs common opponents
                        if (commonOpponents.includes(game.away_abbr) && game.home_abbr === team2) {
                            if (winnerAbbr === team2) team2Wins++;
                            else if (winnerAbbr === game.away_abbr) team2Losses++;
                            else team2Ties++;
                        }
                        if (commonOpponents.includes(game.home_abbr) && game.away_abbr === team2) {
                            if (winnerAbbr === team2) team2Wins++;
                            else if (winnerAbbr === game.home_abbr) team2Losses++;
                            else team2Ties++;
                        }
                    });
                    
                    // Store records for both teams in this matchup
                    const key1 = `${team1}_vs_${team2}`;
                    const key2 = `${team2}_vs_${team1}`;
                    
                    records[key1] = {
                        team: team1,
                        opponent: team2,
                        wins: team1Wins,
                        losses: team1Losses,
                        ties: team1Ties,
                        winPct: team1Wins + team1Losses + team1Ties > 0 
                            ? (team1Wins + team1Ties * 0.5) / (team1Wins + team1Losses + team1Ties)
                            : 0
                    };
                    
                    records[key2] = {
                        team: team2,
                        opponent: team1,
                        wins: team2Wins,
                        losses: team2Losses,
                        ties: team2Ties,
                        winPct: team2Wins + team2Losses + team2Ties > 0 
                            ? (team2Wins + team2Ties * 0.5) / (team2Wins + team2Losses + team2Ties)
                            : 0
                    };
                });
            });
        });
        
        res.json(records);
    } catch (error) {
        console.error('Error calculating common games records:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get head-to-head records for all team matchups
app.get('/api/head-to-head/:season', (req, res) => {
    try {
        const { season } = req.params;
        
        // Get all completed games for the season
        const games = db.prepare(`
            SELECT away_abbr, home_abbr, winner 
            FROM games 
            WHERE season = ? AND status = 'final' AND winner IS NOT NULL
        `).all(season);
        
        // Calculate head-to-head for all possible team pairs
        const records = {};
        const allTeams = Object.keys(TEAM_INFO);
        
        // For each pair of teams, calculate head-to-head
        allTeams.forEach(team1 => {
            allTeams.forEach(team2 => {
                if (team1 >= team2) return; // Only calculate once per pair
                
                // Find head-to-head games
                let team1Wins = 0, team1Losses = 0, team1Ties = 0;
                
                games.forEach(game => {
                    const winnerAbbr = TEAM_NAME_TO_ABBR[game.winner];
                    
                    // Check if this is a head-to-head game
                    if ((game.away_abbr === team1 && game.home_abbr === team2) ||
                        (game.away_abbr === team2 && game.home_abbr === team1)) {
                        
                        if (winnerAbbr === team1) {
                            team1Wins++;
                        } else if (winnerAbbr === team2) {
                            team1Losses++;
                        } else if (!winnerAbbr) {
                            team1Ties++;
                        }
                    }
                });
                
                // Store records for both teams in this matchup
                const key1 = `${team1}_vs_${team2}`;
                const key2 = `${team2}_vs_${team1}`;
                
                const totalGames = team1Wins + team1Losses + team1Ties;
                
                records[key1] = {
                    team: team1,
                    opponent: team2,
                    wins: team1Wins,
                    losses: team1Losses,
                    ties: team1Ties,
                    winPct: totalGames > 0 
                        ? (team1Wins + team1Ties * 0.5) / totalGames
                        : 0
                };
                
                records[key2] = {
                    team: team2,
                    opponent: team1,
                    wins: team1Losses,  // team2's wins are team1's losses
                    losses: team1Wins,  // team2's losses are team1's wins
                    ties: team1Ties,
                    winPct: totalGames > 0 
                        ? (team1Losses + team1Ties * 0.5) / totalGames
                        : 0
                };
            });
        });
        
        res.json(records);
    } catch (error) {
        console.error('Error calculating head-to-head records:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// START SERVER
// ========================================

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all network interfaces

app.listen(PORT, HOST, () => {
    console.log('');
    console.log('🏈 NFL Pick\'em Server Running!');
    console.log('=====================================');
    console.log(`Local:   http://localhost:${PORT}`);
    console.log(`Network: http://<your-ip>:${PORT}`);
    console.log('');
    console.log('To find your IP address, run: ip addr show');
    console.log('Then look for "inet 192.168.x.x"');
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close();
    process.exit(0);
});
