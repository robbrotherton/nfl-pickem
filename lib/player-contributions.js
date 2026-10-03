const { athleteId } = require('./athlete-identity');

// Use production volume, not efficiency (such as passer rating), to recognize
// meaningful contributors who may have moved down the current depth chart.
const categoriesToConsider = [
    ['passingLeader', 2, 'passing yards'],
    ['receivingLeader', 3, 'receiving yards'],
    ['rushingLeader', 2, 'rushing yards'],
    ['sacks', 2, 'sacks'],
    ['totalTackles', 2, 'tackles'],
    ['interceptions', 2, 'interceptions']
];
const MIN_LEADER_FRACTION = 0.25;

function majorContributors(categories = []) {
    const contributors = new Map();
    for (const [name, limit, label] of categoriesToConsider) {
        const rows = categories.find(category => category.name === name)?.leaders || [];
        const leadingValue = Number(rows[0]?.value);
        rows.slice(0, limit).forEach((row, index) => {
            const id = athleteId(row.athlete), value = Number(row.value);
            // A saved scoreboard may supply only its category leader and display
            // text. It can identify that leader, but cannot establish other ranks.
            const meaningful = Number.isFinite(value) && Number.isFinite(leadingValue) ?
                leadingValue > 0 && value > 0 && value >= leadingValue * MIN_LEADER_FRACTION :
                index === 0 && !!row.displayValue && !/^0(?:\D|$)/.test(row.displayValue);
            if (!id || !meaningful) return;
            const evidence = { category: name, rank: index + 1, label: `#${index + 1} in team ${label}`,
                display: row.displayValue || String(value) };
            if (!contributors.has(id)) contributors.set(id, []);
            contributors.get(id).push(evidence);
        });
    }
    return contributors;
}

function keyAbsences(injuries, shown = new Set()) {
    return injuries.filter(player => player.key && player.prominent && !shown.has(player.id)).slice(0, 5);
}

module.exports = { majorContributors, keyAbsences };
