// Shared by the browser and server; NFL seasons are identified by start year.
(function (root) {
    function weekCount(season, type) {
        if (type === 1) return Number(season) >= 2021 ? 4 : 5;
        return type === 3 ? 5 : (Number(season) >= 2021 ? 18 : 17);
    }

    function fallbackSeasonYear(now = new Date()) {
        return now.getFullYear() - (now.getMonth() < 2 ? 1 : 0);
    }

    function assertScoreboardContext(data, season, week, type) {
        const check = (actual, expected, label) => {
            if (actual !== undefined && actual !== null && Number(actual) !== Number(expected)) {
                throw new Error(`ESPN returned ${label} ${actual}; requested ${expected}. No games were saved.`);
            }
        };
        check(data.season?.year, season, 'season');
        check(data.season?.type, type, 'season type');
        check(data.week?.number, week, 'week');
        for (const event of data.events || []) {
            check(event.season?.year, season, 'event season');
            check(event.season?.type, type, 'event season type');
            check(event.week?.number, week, 'event week');
        }
    }

    function shouldRefreshGames(games, now = Date.now()) {
        if (!games?.length) return true;
        // A cached pregame status must not hide games that have since kicked off.
        return games.some(game => game.status === 'in_progress' ||
            (game.status !== 'final' && Date.parse(game.game_date) <= now));
    }

    function storedWeekSelection(games, now = Date.now()) {
        const weeks = new Map();
        for (const game of games) {
            const kickoff = Date.parse(game.game_date);
            if (!Number.isFinite(kickoff) || ![1, 2, 3].includes(Number(game.season_type))) continue;
            const value = `${game.season_type}:${game.week}`;
            const week = weeks.get(value) || { value, start: kickoff, end: kickoff };
            week.start = Math.min(week.start, kickoff);
            week.end = Math.max(week.end, kickoff);
            weeks.set(value, week);
        }
        const ordered = [...weeks.values()].sort((a, b) => a.start - b.start);
        // Keep the current week through its final game and the following day.
        return (ordered.find(week => week.end + 24 * 60 * 60 * 1000 > now) || ordered.at(-1))?.value || null;
    }

    const api = { weekCount, fallbackSeasonYear, assertScoreboardContext, shouldRefreshGames, storedWeekSelection };
    root.NFLSeason = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
