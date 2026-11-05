(function (root) {
    // Records belong to a team/season, not the week when a future schedule was saved.
    function teamContext(seasonGames, weekGames, season, week) {
        const games = new Map();
        for (const game of [...seasonGames, ...weekGames]) {
            if (Number(game.season) === Number(season) && Number(game.season_type) === 2) games.set(String(game.id), game);
        }
        const teams = new Map();
        const records = {};
        const recordGames = {};
        for (const game of games.values()) {
            for (const side of ['away', 'home']) {
                const name = game[`${side}_team`];
                if (!name) continue;
                teams.set(name, { name, logo: game[`${side}_logo`] || '' });
                const record = game[`${side}_record`];
                if (/^\d+-\d+(-\d+)?$/.test(record || '')) {
                    const count = record.split('-').reduce((sum, n) => sum + Number(n), 0);
                    if (count > (recordGames[name] ?? -1)) {
                        recordGames[name] = count;
                        records[name] = record;
                    }
                }
            }
        }
        const playing = new Set(weekGames.flatMap(game => [game.away_team, game.home_team]));
        // Only infer byes with a full league directory and a published regular-season week.
        const byes = teams.size === 32 && weekGames.length && weekGames.every(game =>
            Number(game.season) === Number(season) && Number(game.season_type) === 2 && Number(game.week) === Number(week))
            ? [...teams.values()].filter(team => !playing.has(team.name)).sort((a, b) => a.name.localeCompare(b.name)) : [];
        return { records, byes };
    }
    const api = { teamContext };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.NFLSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
