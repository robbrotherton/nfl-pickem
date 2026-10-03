const { buildPlayerContext } = require('./player-context');
const { athleteId } = require('./athlete-identity');

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const HOUR = 60 * 60 * 1000;
function availabilityTtl(kickoff, now) {
    const remaining = Date.parse(kickoff) - now;
    return remaining >= 0 && remaining <= 6 * HOUR ? HOUR / 2 : 6 * HOUR;
}
function upcoming(game, now) {
    return Number(game.season_type) === 2 && game.status !== 'final' &&
        Date.parse(game.game_date) > now && Date.parse(game.game_date) - now < 8 * 24 * HOUR;
}

function createAvailability({ db, store, cache, now }) {
    const pending = new Map();
    async function read(url, ttl, options, warnings) {
        try {
            const result = await cache.get(url, ttl, options);
            if (result.stale) warnings.push('Some ESPN data could not be refreshed; saved data is shown with its earlier update time.');
            return result;
        } catch {
            warnings.push('Some ESPN data is unavailable.');
            return null;
        }
    }
    async function get(game, name, teamId, { withStats = true } = {}) {
        const key = `${game.id}:${teamId}:${withStats}`;
        if (pending.has(key)) return pending.get(key);
        const task = assemble(game, name, teamId, withStats);
        pending.set(key, task);
        try { return await task; } finally { pending.delete(key); }
    }
    async function assemble(game, name, teamId, withStats) {
        const warnings = [];
        const next = db.prepare("SELECT game_date FROM games WHERE season_type=2 AND status!='final' AND game_date>? ORDER BY game_date LIMIT 1")
            .get(new Date(now()).toISOString());
        const injuryTtl = Math.min(availabilityTtl(game.game_date, now()), next ? availabilityTtl(next.game_date, now()) : 6 * HOUR);
        const depthUrl = `${BASE}/teams/${teamId}/depthcharts`;
        const last = db.prepare("SELECT id FROM games WHERE season=? AND season_type=2 AND status='final' AND game_date<? AND (away_team=? OR home_team=?) ORDER BY game_date DESC LIMIT 1")
            .get(game.season, game.game_date, name, name);
        const leaderUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${game.season}/types/2/teams/${teamId}/leaders?lang=en&region=us`;
        const [report, depth, leaders] = await Promise.all([
            read(`${BASE}/injuries`, injuryTtl, { validate: data => {
                if (Number(data.season?.year) !== game.season || !Array.isArray(data.injuries)) throw new Error('Injury report context mismatch');
            } }, warnings),
            teamId ? read(depthUrl, availabilityTtl(game.game_date, now()), { validate: data => {
                if (Number(data.season?.year) !== game.season || !Array.isArray(data.depthchart)) throw new Error('Depth chart context mismatch');
            } }, warnings) : null,
            teamId && withStats ? read(leaderUrl, 12 * HOUR, { version: last?.id || 'no-final-games', validate: data => {
                if (!Array.isArray(data.categories)) throw new Error('Player leaders unavailable');
                if (data.$ref && !data.$ref.includes(`/seasons/${game.season}/types/2/teams/${teamId}/`)) throw new Error('Player leader context mismatch');
            } }, warnings) : null
        ]);
        const injuryTeam = report?.data.injuries.find(team => String(team.id) === String(teamId) || team.displayName === name);
        const snapshot = store.leaders(game.id, teamId);
        const saved = snapshot?.scope === 'season' && snapshot.season === game.season && snapshot.season_type === 2 ? JSON.parse(snapshot.players) : [];
        const roles = store.roles(teamId, game.season);
        const categories = leaders?.data.categories?.length ? leaders.data.categories : saved;
        for (const category of categories) for (const leader of category.leaders || []) {
            roles.set(athleteId(leader.athlete), 'Saved team contributor');
        }
        const context = { name, ...buildPlayerContext({ depth: depth?.data, categories, savedCategories: saved,
            injuryRows: injuryTeam?.injuries || [], reportAvailable: !!injuryTeam, roles,
            previousQuarterback: store.availability(game, teamId)?.quarterbacks.primary }),
            capturedAt: now(), injuryUpdatedAt: report?.fetchedAt || null, depthUpdatedAt: depth?.fetchedAt || null,
            statsUpdatedAt: leaders?.fetchedAt || (saved.length ? snapshot.fetched_at : null),
            reportTimestamp: report?.data.timestamp || null, historical: false, warnings };
        // The archive retains availability, not season totals collected after a game.
        if (context.depthAvailable && context.reportAvailable && !depth.stale && !report.stale) {
            const { highlights, statsUpdatedAt, ...archive } = context;
            const stripStats = player => player ? { ...player, metrics: [] } : null;
            archive.quarterbacks = { ...archive.quarterbacks, primary: stripStats(archive.quarterbacks.primary), replacement: stripStats(archive.quarterbacks.replacement) };
            archive.highlights = [];
            const quarterbackIds = new Set([archive.quarterbacks.primary?.id, archive.quarterbacks.replacement?.id]);
            archive.absences = archive.injuries.filter(player => player.key && player.role === 'Listed starter' && !quarterbackIds.has(player.id)).slice(0, 5);
            store.saveAvailability(game, teamId, archive);
        }
        return context;
    }

    // Piggyback on current scoreboard reads: one shared injury feed and cached team
    // depth charts. No polling timer, summaries, or player-stat fetches for archiving.
    async function captureScoreboard(scoreboard) {
        const games = [];
        for (const event of scoreboard.events || []) {
            const season = Number(event.season?.year || scoreboard.season?.year);
            const seasonType = Number(event.season?.type || scoreboard.season?.type);
            const competition = event.competitions?.[0];
            if (competition?.status?.type?.state !== 'pre') continue;
            const game = { id: String(event.id), season, season_type: seasonType, game_date: event.date, status: 'scheduled' };
            if (!upcoming(game, now())) continue;
            for (const competitor of competition.competitors || []) {
                if (competitor.team?.id && competitor.team.displayName) games.push({ game, name: competitor.team.displayName, teamId: String(competitor.team.id) });
            }
        }
        // Keep the initial week-wide capture modest in parallelism.
        for (let offset = 0; offset < games.length; offset += 4) {
            await Promise.all(games.slice(offset, offset + 4).map(({ game, name, teamId }) => get(game, name, teamId, { withStats: false })));
        }
    }
    return { get, captureScoreboard };
}

module.exports = { createAvailability, availabilityTtl, upcoming };
