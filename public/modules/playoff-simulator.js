// playoff-simulator.js
// Monte Carlo NFL playoff simulator with reseeding and per-game probabilities

/**
 * Simulate a single NFL playoff run with reseeding after each round.
 * @param {Array} playoffTeams - Array of 14 teams, each with {abbr, seed, conference, ...}
 * @param {Function} getGameProb - (homeTeam, awayTeam) => probability home wins (0..1)
 * @returns {Object} - { rounds: {teamAbbr: [roundsSurvived]}, winner: teamAbbr }
 */
export function simulatePlayoffRun(playoffTeams, getGameProb) {
    // Helper: deep clone teams for this sim
    const deepClone = obj => JSON.parse(JSON.stringify(obj));
    const nfc = deepClone(playoffTeams.filter(t => t.conference === 'NFC'));
    const afc = deepClone(playoffTeams.filter(t => t.conference === 'AFC'));
    // Track which round each team reaches
    const rounds = {};
    nfc.concat(afc).forEach(t => { rounds[t.abbr] = 0; });

    // Simulate one conference bracket
    function simulateConferenceBracket(teams) {
        // Initial seeding
        let round = 0;
        let survivors = teams.slice().sort((a, b) => a.seed - b.seed);
        // Wild Card: seeds 2-7 play, 1 gets bye
        let wcWinners = [survivors[0]]; // #1 seed advances
        rounds[survivors[0].abbr] = Math.max(rounds[survivors[0].abbr], 1);
        for (let i = 1; i < 7; i += 2) {
            const home = survivors[i];
            const away = survivors[i+1];
            const prob = getGameProb(home, away);
            const winner = Math.random() < prob ? home : away;
            wcWinners.push(winner);
            rounds[winner.abbr] = Math.max(rounds[winner.abbr], 1);
        }
        // Divisional & Conference rounds
        for (round = 2; round <= 3; round++) {
            // Reseed: sort by seed
            wcWinners.sort((a, b) => a.seed - b.seed);
            const nextWinners = [];
            for (let i = 0; i < wcWinners.length; i += 2) {
                const home = wcWinners[i];
                const away = wcWinners[i+1];
                if (!away) { nextWinners.push(home); continue; }
                const prob = getGameProb(home, away);
                const winner = Math.random() < prob ? home : away;
                nextWinners.push(winner);
                rounds[winner.abbr] = Math.max(rounds[winner.abbr], round);
            }
            wcWinners.length = 0;
            wcWinners.push(...nextWinners);
        }
        // Return conference champ
        return wcWinners[0];
    }

    // Simulate both conferences
    const nfcChamp = simulateConferenceBracket(nfc);
    const afcChamp = simulateConferenceBracket(afc);
    // Super Bowl
    const sbProb = getGameProb(nfcChamp, afcChamp);
    const sbWinner = Math.random() < sbProb ? nfcChamp : afcChamp;
    rounds[nfcChamp.abbr] = Math.max(rounds[nfcChamp.abbr], 4);
    rounds[afcChamp.abbr] = Math.max(rounds[afcChamp.abbr], 4);
    rounds[sbWinner.abbr] = 5;
    return { rounds, winner: sbWinner.abbr };
}

/**
 * Run many playoff simulations and aggregate results.
 * @param {Array} playoffTeams - 14 teams with seeds/conference
 * @param {Function} getGameProb - (home, away) => probability home wins
 * @param {number} numSims - Number of simulations
 * @returns {Object} - { teamStats: {abbr: {WC, Div, Conf, SB, Champ, ...}}, winCounts: {...} }
 */
export function runPlayoffSimulations(playoffTeams, getGameProb, numSims = 10000) {
    const teamStats = {};
    playoffTeams.forEach(t => {
        teamStats[t.abbr] = { WC: 0, Div: 0, Conf: 0, SB: 0, Champ: 0 };
    });
    for (let i = 0; i < numSims; i++) {
        const { rounds, winner } = simulatePlayoffRun(playoffTeams, getGameProb);
        for (const abbr in rounds) {
            if (rounds[abbr] >= 1) teamStats[abbr].WC++;
            if (rounds[abbr] >= 2) teamStats[abbr].Div++;
            if (rounds[abbr] >= 3) teamStats[abbr].Conf++;
            if (rounds[abbr] >= 4) teamStats[abbr].SB++;
            if (rounds[abbr] === 5) teamStats[abbr].Champ++;
        }
    }
    // Convert counts to probabilities
    for (const abbr in teamStats) {
        for (const key in teamStats[abbr]) {
            teamStats[abbr][key] = teamStats[abbr][key] / numSims;
        }
    }
    return { teamStats };
}
