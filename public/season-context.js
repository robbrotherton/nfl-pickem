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

    const api = { weekCount, fallbackSeasonYear, assertScoreboardContext };
    root.NFLSeason = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
