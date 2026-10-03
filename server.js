// NFL Pick'em Server
// Simple Express + SQLite backend for home network

const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'nfl-pickem.db'));
const { assertScoreboardContext, weekCount } = require('./public/season-context.js');

const ESPN_SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database tables
db.exec(`
    CREATE TABLE IF NOT EXISTS players (
        name TEXT PRIMARY KEY,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS week_players (
        season INTEGER,
        week INTEGER,
        season_type INTEGER,
        player_name TEXT,
        display_order INTEGER,
        PRIMARY KEY (season, season_type, week, player_name)
    );

    CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        season INTEGER,
        week INTEGER,
        season_type INTEGER,
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
        season_type INTEGER,
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

// Migrate existing games table to add season_type column if it doesn't exist
try {
    db.exec(`
        ALTER TABLE games ADD COLUMN season_type INTEGER;
    `);
} catch (e) {
    // Column already exists, ignore
}

// Migrate week_players to include season_type in schema and primary key
try {
    const weekPlayersInfo = db.prepare(`PRAGMA table_info(week_players)`).all();
    const hasSeasonType = weekPlayersInfo.some(col => col.name === 'season_type');
    const pkColumns = weekPlayersInfo
        .filter(col => col.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map(col => col.name);
    const needsPkUpdate = !pkColumns.includes('season_type');

    if (!hasSeasonType || needsPkUpdate) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS week_players_new (
                season INTEGER,
                week INTEGER,
                season_type INTEGER,
                player_name TEXT,
                display_order INTEGER,
                PRIMARY KEY (season, season_type, week, player_name)
            );
        `);

        if (hasSeasonType) {
            db.exec(`
                INSERT INTO week_players_new (season, week, season_type, player_name, display_order)
                SELECT season, week, COALESCE(season_type, 2), player_name, display_order FROM week_players;
            `);
        } else {
            db.exec(`
                INSERT INTO week_players_new (season, week, season_type, player_name, display_order)
                SELECT season, week, 2 as season_type, player_name, display_order FROM week_players;
            `);
        }

        db.exec(`
            DROP TABLE week_players;
            ALTER TABLE week_players_new RENAME TO week_players;
        `);
    }
} catch (e) {
    console.error('Error migrating week_players schema:', e);
}

// Migrate picks table to add season_type column if it doesn't exist
try {
    db.exec(`
        ALTER TABLE picks ADD COLUMN season_type INTEGER;
    `);
} catch (e) {
    // Column already exists, ignore
}

// Backfill picks.season_type from games table when missing
try {
    db.exec(`
        UPDATE picks
        SET season_type = (
            SELECT season_type FROM games WHERE games.id = picks.game_id
        )
        WHERE season_type IS NULL;
    `);
    db.exec(`
        UPDATE picks
        SET season_type = 2
        WHERE season_type IS NULL;
    `);
} catch (e) {
    console.error('Error backfilling picks season_type:', e);
}

// Reject ambiguous season filters before any route can read or mutate data.
app.param('season', (req, res, next, value) => {
    if (!/^\d{4}$/.test(value) || Number(value) < 2000 || Number(value) > 2100) {
        return res.status(400).json({ error: 'Invalid season.' });
    }
    next();
});
app.param('week', (req, res, next, value) => {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 22) {
        return res.status(400).json({ error: 'Invalid week.' });
    }
    const type = req.query.playoff === '1' ? 3 : Number(req.query.season_type || 2);
    if (Number(value) > weekCount(req.params.season, type)) {
        return res.status(400).json({ error: 'Week is outside the selected season type.' });
    }
    next();
});
app.use('/api', (req, res, next) => {
    for (const source of [req.query, req.body]) {
        if (source.season_type !== undefined && !/^[123]$/.test(String(source.season_type))) {
            return res.status(400).json({ error: 'Invalid season_type (expected 1, 2, or 3).' });
        }
    }
    if (req.body.season !== undefined && (!/^\d{4}$/.test(String(req.body.season)) || Number(req.body.season) < 2000 || Number(req.body.season) > 2100)) {
        return res.status(400).json({ error: 'Invalid season.' });
    }
    if (req.body.week !== undefined && (!/^\d+$/.test(String(req.body.week)) || Number(req.body.week) < 1 || Number(req.body.week) > 22)) {
        return res.status(400).json({ error: 'Invalid week.' });
    }
    if (req.method === 'POST' && ['/games', '/picks', '/week-players'].includes(req.path)) {
        if (req.body.season === undefined || req.body.week === undefined) {
            return res.status(400).json({ error: 'Season and week are required.' });
        }
        if (Number(req.body.week) > weekCount(req.body.season, Number(req.body.season_type || 2))) {
            return res.status(400).json({ error: 'Week is outside the selected season type.' });
        }
    }
    next();
});

// ========================================
// Get all games for a season (optionally filter by season_type)
app.get('/api/games/:season', (req, res) => {
    try {
        let { season } = req.params;
        const { season_type } = req.query;
        season = parseInt(season, 10);
        if (!Number.isInteger(season) || season < 2000 || season > 2100) {
            res.status(400).json({ error: 'Invalid or missing season parameter.' });
            return;
        }
        let games;
        if (season_type !== undefined) {
            const seasonTypeInt = parseInt(season_type, 10);
            games = db.prepare(
                'SELECT * FROM games WHERE season = ? AND season_type = ? ORDER BY week, game_date, home_team'
            ).all(season, seasonTypeInt);
        } else {
            games = db.prepare(
                'SELECT * FROM games WHERE season = ? ORDER BY week, game_date, home_team'
            ).all(season);
        }
        res.json(games);
    } catch (error) {
        console.error('Error fetching games for season:', error);
        res.status(500).json({ error: error.message });
    }
});
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

// Seed missing season weeks (defaults to regular season; can be season_type=1 for preseason)
app.post('/api/season/:season/seed', async (req, res) => {
    try {
        const season = parseInt(req.params.season, 10);
        if (!Number.isInteger(season) || season < 2000 || season > 2100) {
            res.status(400).json({ error: 'Invalid or missing season parameter.' });
            return;
        }

        const force = req.query.force === '1';
        const seasonTypeInt = req.query.season_type ? parseInt(req.query.season_type, 10) : 2;
        if (![1, 2, 3].includes(seasonTypeInt)) {
            res.status(400).json({ error: 'Invalid season_type (expected 1, 2, or 3).' });
            return;
        }
        const delayMs = Math.max(0, parseInt(req.query.delay_ms, 10) || 300);

        const weekCounts = db.prepare(`
            SELECT week, COUNT(*) as games
            FROM games
            WHERE season = ? AND season_type = ?
            GROUP BY week
        `).all(season, seasonTypeInt);

        const countsByWeek = {};
        weekCounts.forEach(row => {
            countsByWeek[row.week] = row.games;
        });

        const maxWeeks = weekCount(season, seasonTypeInt);
        const weeksToSeed = [];
        for (let week = 1; week <= maxWeeks; week++) {
            const count = countsByWeek[week] || 0;
            if (force || count === 0) {
                weeksToSeed.push(week);
            }
        }

        if (weeksToSeed.length === 0) {
            res.json({ season, season_type: seasonTypeInt, message: 'No missing weeks to seed.' });
            return;
        }

        let totalInserted = 0;
        for (let i = 0; i < weeksToSeed.length; i++) {
            const week = weeksToSeed[i];
            const data = await fetchEspnScoreboard(season, week, seasonTypeInt);

            const seasonYear = data?.season?.year;
            const seasonType = data?.season?.type;
            assertScoreboardContext(data, season, week, seasonTypeInt);
            for (const event of data.events || []) {
                const existing = db.prepare('SELECT season, week, season_type FROM games WHERE id = ?').get(event.id);
                if (existing && (existing.season !== season || existing.week !== week || existing.season_type !== seasonTypeInt)) {
                    throw new Error(`Game ${event.id} already belongs to a different season/week/type.`);
                }
            }

            const events = data?.events || [];
            for (const event of events) {
                const competition = event.competitions?.[0];
                if (!competition) continue;
                const homeTeam = competition.competitors?.find(t => t.homeAway === 'home');
                const awayTeam = competition.competitors?.find(t => t.homeAway === 'away');
                if (!homeTeam || !awayTeam) continue;

                const isCompleted = event.status?.type?.completed;
                const isInProgress = event.status?.type?.state === 'in';

                const awayLogos = getTeamLogos(awayTeam);
                const homeLogos = getTeamLogos(homeTeam);

                const gameData = {
                    id: event.id,
                    season: seasonYear || season,
                    season_type: seasonType || seasonTypeInt,
                    week,
                    game_date: event.date,
                    away_team: awayTeam.team.displayName,
                    home_team: homeTeam.team.displayName,
                    away_abbr: awayTeam.team.abbreviation,
                    home_abbr: homeTeam.team.abbreviation,
                    away_logo: awayLogos.logo,
                    home_logo: homeLogos.logo,
                    away_wordmark: awayLogos.wordmark,
                    home_wordmark: homeLogos.wordmark,
                    away_record: awayTeam.records?.[0]?.summary || '0-0',
                    home_record: homeTeam.records?.[0]?.summary || '0-0',
                    away_score: isCompleted || isInProgress ? parseInt(awayTeam.score, 10) : null,
                    home_score: isCompleted || isInProgress ? parseInt(homeTeam.score, 10) : null,
                    winner: isCompleted ? competition.competitors.find(t => t.winner)?.team.displayName : null,
                    status: isCompleted ? 'final' : isInProgress ? 'in_progress' : 'scheduled'
                };

                db.prepare(`
                    INSERT OR REPLACE INTO games 
                    (id, season, week, season_type, game_date, away_team, home_team, away_abbr, home_abbr, 
                     away_logo, home_logo, away_wordmark, home_wordmark, away_record, home_record, away_score, home_score, winner, status, last_updated) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                `).run(
                    gameData.id,
                    gameData.season,
                    gameData.week,
                    gameData.season_type,
                    gameData.game_date,
                    gameData.away_team,
                    gameData.home_team,
                    gameData.away_abbr,
                    gameData.home_abbr,
                    gameData.away_logo,
                    gameData.home_logo,
                    gameData.away_wordmark,
                    gameData.home_wordmark,
                    gameData.away_record,
                    gameData.home_record,
                    gameData.away_score,
                    gameData.home_score,
                    gameData.winner,
                    gameData.status
                );

                totalInserted += 1;
            }

            if (i < weeksToSeed.length - 1 && delayMs > 0) {
                await sleep(delayMs);
            }
        }

        res.json({ season, season_type: seasonTypeInt, seededWeeks: weeksToSeed, totalInserted });
    } catch (error) {
        console.error('Error seeding season schedule:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get players for a specific week
app.get('/api/week-players/:season/:week', (req, res) => {
    try {
        const { season, week } = req.params;
        const { season_type } = req.query;
        const seasonTypeInt = season_type !== undefined ? parseInt(season_type, 10) : 2;
        const players = db.prepare(
            'SELECT * FROM week_players WHERE season = ? AND week = ? AND season_type = ? ORDER BY display_order'
        ).all(season, week, seasonTypeInt);
        res.json(players);
    } catch (error) {
        console.error('Error fetching week players:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add player to a week
app.post('/api/week-players', (req, res) => {
    try {
        const { season, week, season_type, player_name, display_order } = req.body;
        const seasonTypeInt = season_type !== undefined ? parseInt(season_type, 10) : 2;
        
        // Add to players table if not exists
        db.prepare('INSERT OR IGNORE INTO players (name) VALUES (?)').run(player_name);
        
        // Add to week_players
        db.prepare(
            'INSERT OR REPLACE INTO week_players (season, week, season_type, player_name, display_order) VALUES (?, ?, ?, ?, ?)'
        ).run(season, week, seasonTypeInt, player_name, display_order);
        
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
        const { season_type } = req.query;
        const seasonTypeInt = season_type !== undefined ? parseInt(season_type, 10) : 2;
        db.prepare(
            'DELETE FROM week_players WHERE season = ? AND week = ? AND season_type = ? AND player_name = ?'
        ).run(season, week, seasonTypeInt, decodeURIComponent(player));
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing week player:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get games for a week

// Get all games for a week (with optional playoff filter)
app.get('/api/games/:season/:week', (req, res) => {
    try {
        let { season, week } = req.params;
        const { playoff, season_type } = req.query;
        // Validate season is a positive integer
        season = parseInt(season, 10);
        week = parseInt(week, 10);
        let seasonTypeInt = season_type !== undefined ? parseInt(season_type, 10) : undefined;
        if (!Number.isInteger(season) || season < 2000 || season > 2100) {
            res.status(400).json({ error: 'Invalid or missing season parameter.' });
            console.warn(`[API] /api/games/: Invalid season param: ${season}`);
            return;
        }
        if (!Number.isInteger(week) || week < 1 || week > 22) {
            res.status(400).json({ error: 'Invalid or missing week parameter.' });
            console.warn(`[API] /api/games/: Invalid week param: ${week}`);
            return;
        }
        let games;
        // Legacy playoff flag maps to the explicit postseason type.
        if (playoff === '1' && seasonTypeInt !== undefined && seasonTypeInt !== 3) {
            return res.status(400).json({ error: 'Conflicting playoff and season_type filters.' });
        }
        seasonTypeInt = playoff === '1' ? 3 : (seasonTypeInt ?? 2);
        games = db.prepare(
            'SELECT * FROM games WHERE season = ? AND week = ? AND season_type = ? ORDER BY game_date, home_team'
        ).all(season, week, seasonTypeInt);
        if (games.length > 0) {
            games.forEach(g => {
                console.log(`  - ${g.away_abbr} @ ${g.home_abbr} (${g.game_date}) status=${g.status}`);
            });
        }
        res.json(games);
    } catch (error) {
        console.error('Error fetching games:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save/update game
app.post('/api/games', (req, res) => {
    try {
        const { id, season, week, season_type, game_date, away_team, home_team, away_abbr, home_abbr, 
            away_logo, home_logo, away_wordmark, home_wordmark, away_record, home_record, away_score, home_score, winner, status } = req.body;

        if (season === undefined || week === undefined || season_type === undefined) {
            return res.status(400).json({ error: 'Game season, week, and season_type are required.' });
        }
        const existing = db.prepare('SELECT season, week, season_type FROM games WHERE id = ?').get(id);
        if (existing && (existing.season !== Number(season) || existing.week !== Number(week) || existing.season_type !== Number(season_type))) {
            return res.status(409).json({ error: 'Cannot move an existing game to another season/week/type.' });
        }

        db.prepare(`
            INSERT OR REPLACE INTO games 
            (id, season, week, season_type, game_date, away_team, home_team, away_abbr, home_abbr, 
             away_logo, home_logo, away_wordmark, home_wordmark, away_record, home_record, away_score, home_score, winner, status, last_updated) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, season, week, season_type, game_date, away_team, home_team, away_abbr, home_abbr, 
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
        let { season, week } = req.params;
        const { season_type } = req.query;
        season = parseInt(season, 10);
        week = parseInt(week, 10);
        // Omitted filter means regular season, never every type with this week number.
        const seasonTypeInt = season_type !== undefined ? Number(season_type) : 2;
        db.prepare('DELETE FROM games WHERE season = ? AND week = ? AND season_type = ?').run(season, week, seasonTypeInt);
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
        const decodedTeamName = teamName;
        const seasonType = req.query.season_type === undefined ? 2 : Number(req.query.season_type);
        
        const games = db.prepare(`
            SELECT * FROM games 
            WHERE season = ? AND season_type = ? AND (away_team = ? OR home_team = ?)
            ORDER BY week ASC, game_date ASC
        `).all(season, seasonType, decodedTeamName, decodedTeamName);
        
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
        const { season_type } = req.query;
        const seasonTypeInt = season_type !== undefined ? parseInt(season_type, 10) : 2;
        const picks = db.prepare(
            'SELECT * FROM picks WHERE season = ? AND week = ? AND season_type = ?'
        ).all(season, week, seasonTypeInt);
        res.json(picks);
    } catch (error) {
        console.error('Error fetching picks:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save a pick
app.post('/api/picks', (req, res) => {
    try {
        const { player_name, game_id, season, week, season_type, picked_team } = req.body;
        const seasonTypeInt = season_type !== undefined ? parseInt(season_type, 10) : 2;
        
        const game = db.prepare('SELECT * FROM games WHERE id = ?').get(game_id);
        if (!game || game.season !== Number(season) || game.week !== Number(week) || game.season_type !== seasonTypeInt) {
            return res.status(400).json({ error: 'Pick season/week/type must match its game.' });
        }
        if (picked_team !== game.away_team && picked_team !== game.home_team) {
            return res.status(400).json({ error: 'Picked team must be in the game.' });
        }

        db.prepare(`
            INSERT OR REPLACE INTO picks 
            (player_name, game_id, season, week, season_type, picked_team, is_correct, picked_at) 
            VALUES (?, ?, ?, ?, ?, ?, NULL, datetime('now'))
        `).run(player_name, game_id, season, week, seasonTypeInt, picked_team);
        
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
        const { season_type } = req.query;
        const seasonTypeInt = season_type !== undefined ? parseInt(season_type, 10) : null;
        
        let standings;
        if (seasonTypeInt !== null && !isNaN(seasonTypeInt)) {
            standings = db.prepare(`
                SELECT 
                    p.player_name,
                    SUM(CASE WHEN p.is_correct = 1 THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN p.is_correct = 0 THEN 1 ELSE 0 END) as losses,
                    COUNT(DISTINCT p.week) as weeks_played
                FROM picks p
                JOIN games g ON g.id = p.game_id AND g.season = p.season
                WHERE p.season = ? AND p.is_correct IS NOT NULL AND g.season_type = ?
                GROUP BY p.player_name
                ORDER BY 
                    CAST(SUM(CASE WHEN p.is_correct = 1 THEN 1 ELSE 0 END) AS FLOAT) / 
                    NULLIF(COUNT(*), 0) DESC,
                    wins DESC
            `).all(season, seasonTypeInt);
        } else {
            standings = db.prepare(`
                SELECT 
                    player_name,
                    SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as losses,
                    COUNT(DISTINCT season_type || ':' || week) as weeks_played
                FROM picks
                WHERE season = ? AND is_correct IS NOT NULL
                GROUP BY player_name
                ORDER BY 
                    CAST(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS FLOAT) / 
                    NULLIF(COUNT(*), 0) DESC,
                    wins DESC
            `).all(season);
        }
        
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
        const { season_type } = req.query;
        const seasonTypeInt = season_type !== undefined ? parseInt(season_type, 10) : 2;
        
        let standings;
        if (seasonTypeInt !== null && !isNaN(seasonTypeInt)) {
            standings = db.prepare(`
                SELECT 
                    p.player_name,
                    SUM(CASE WHEN p.is_correct = 1 THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN p.is_correct = 0 THEN 1 ELSE 0 END) as losses
                FROM picks p
                JOIN games g ON g.id = p.game_id AND g.season = p.season
                WHERE p.season = ? AND p.week = ? AND p.is_correct IS NOT NULL AND g.season_type = ?
                GROUP BY p.player_name
                ORDER BY 
                    CAST(SUM(CASE WHEN p.is_correct = 1 THEN 1 ELSE 0 END) AS FLOAT) / 
                    NULLIF(COUNT(*), 0) DESC,
                    wins DESC
            `).all(season, week, seasonTypeInt);
        } else {
            standings = db.prepare(`
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
        }
        
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
            WHERE season = ? AND season_type = 2 AND status = 'final'
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
            WHERE season = ? AND season_type = 2 AND status = 'final'
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
            WHERE season = ? AND season_type = 2 AND status = 'final'
        `).all(season);
        
        // Calculate common games record for ALL team pairs (not just within divisions)
        // This is needed for wild card and division winner seeding tiebreakers
        const records = {};
        const allTeams = Object.keys(TEAM_INFO);
        
        // For each pair of teams, calculate common games record
        allTeams.forEach(team1 => {
            allTeams.forEach(team2 => {
                if (team1 >= team2) return; // Only calculate once per pair
                
                // Find common opponents (teams that both team1 and team2 have played)
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
            WHERE season = ? AND season_type = 2 AND status = 'final'
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
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces

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

function fetchEspnScoreboard(season, week, seasonType = 2) {
    const url = `${ESPN_SCOREBOARD_BASE}?dates=${season}&seasontype=${seasonType}&week=${week}`;
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`ESPN fetch failed with status ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', err => reject(err));
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getTeamLogos(competitor) {
    const abbr = competitor.team.abbreviation.toUpperCase();
    const abbrMap = { WSH: 'WAS' };
    const wordmarkAbbr = abbrMap[abbr] || abbr;
    const logo = competitor.team.logo || '';
    const wordmark = `https://raw.githubusercontent.com/nflverse/nflverse-pbp/master/wordmarks/${wordmarkAbbr}.png`;
    return { logo, wordmark };
}
