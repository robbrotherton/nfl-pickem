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

console.log('Database initialized ✓');

// ========================================
// API ENDPOINTS
// ========================================

// Get all players (for autocomplete)
app.get('/api/players', (req, res) => {
    try {
        const players = db.prepare('SELECT * FROM players ORDER BY name').all();
        res.json(players);
    } catch (error) {
        console.error('Error fetching players:', error);
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
            'SELECT * FROM games WHERE season = ? AND week = ? ORDER BY game_date'
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
                away_logo, home_logo, away_record, home_record, away_score, home_score, winner, status } = req.body;
        
        db.prepare(`
            INSERT OR REPLACE INTO games 
            (id, season, week, game_date, away_team, home_team, away_abbr, home_abbr, 
             away_logo, home_logo, away_record, home_record, away_score, home_score, winner, status, last_updated) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, season, week, game_date, away_team, home_team, away_abbr, home_abbr, 
               away_logo, home_logo, away_record, home_record, away_score, home_score, winner, status);
        
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
            ORDER BY wins DESC
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
            ORDER BY wins DESC
        `).all(season, week);
        
        res.json(standings);
    } catch (error) {
        console.error('Error fetching week leaderboard:', error);
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
