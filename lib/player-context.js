const { athleteId } = require('./athlete-identity');
const { majorContributors, keyAbsences } = require('./player-contributions');

const unavailableStatuses = new Set(['out', 'injured reserve', 'reserve', 'suspended', 'physically unable to perform']);
const severity = { out: 4, 'injured reserve': 4, doubtful: 3, questionable: 2, 'day-to-day': 1 };
const statLabels = { passingLeader: 'Passing', quarterbackRating: 'Passer rating', receivingLeader: 'Receiving',
    rushingLeader: 'Rushing', sacks: 'Sacks', totalTackles: 'Tackles', interceptions: 'Interceptions' };
function unavailable(status) { return unavailableStatuses.has(String(status || '').toLowerCase()); }
function injuryStatus(row) { return row?.status || row?.type?.description || ''; }

function depthChart(depth) {
    const athletes = new Map(), starters = new Map();
    let quarterbacks = [];
    for (const formation of depth?.depthchart || []) {
        for (const slot of Object.values(formation.positions || {})) {
            const position = slot.position?.abbreviation || '';
            const players = (slot.athletes || []).filter(athlete => athleteId(athlete));
            for (const athlete of players) athletes.set(athleteId(athlete), { ...athlete, position: { abbreviation: position } });
            if (players[0]) starters.set(athleteId(players[0]), position);
            if (position === 'QB' && !quarterbacks.length) quarterbacks = players.map(athleteId);
        }
    }
    return { athletes, starters, quarterbacks };
}

function injuryRowsWithDepth(rows, index) {
    const result = [...rows], ids = new Set(rows.map(row => athleteId(row.athlete)));
    for (const [id, athlete] of index.athletes) {
        if (!ids.has(id) && athlete.injuries?.length) result.push({ ...athlete.injuries[0], athlete });
    }
    return result;
}

function rankInjuries(rows, depth, roles = new Map(), contributors = new Map(), previousQuarterback = null) {
    const index = depthChart(depth);
    return injuryRowsWithDepth(rows, index)
        .filter(row => !['active', 'healthy'].includes(String(injuryStatus(row)).toLowerCase()))
        .map(row => {
            const id = athleteId(row.athlete), position = row.athlete?.position?.abbreviation || index.starters.get(id) || '';
            const previouslyQb1 = previousQuarterback?.id === id;
            const role = index.starters.has(id) ? 'Listed starter' : previouslyQb1 ? 'Previously listed QB1' : roles.get(id) || 'Role unconfirmed';
            const status = injuryStatus(row) || 'Status unavailable';
            const contributions = contributors.get(id) || [];
            const prominent = index.starters.has(id) || contributions.length > 0 || previouslyQb1;
            const importance = index.starters.has(id) ? 50 : contributions.length || previouslyQb1 ? 40 : roles.has(id) ? 20 : 0;
            const impact = unavailable(status) ? 4 : severity[status.toLowerCase()] || 0;
            return { id, name: row.athlete?.displayName || row.athlete?.fullName || 'Player', position, role, status,
                contributions, prominent, previouslyQb1,
                reason: row.details?.type || '', updatedAt: row.date || null, comment: row.shortComment || '',
                source: source(row.athlete), rank: (position === 'QB' && prominent ? 100 : 0) + importance + (contributions.length ? 30 : 0) + impact,
                key: importance > 0 && impact >= 2 };
        }).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
}

function source(athlete) {
    return athlete?.links?.find(link => link.href?.startsWith('https://www.espn.com/'))?.href ||
        `https://www.espn.com/nfl/player/_/id/${athleteId(athlete)}`;
}

function buildPlayerContext({ depth, categories = [], savedCategories = [], injuryRows = [], reportAvailable = false, roles = new Map(), previousQuarterback = null }) {
    const index = depthChart(depth), athletes = new Map(index.athletes);
    for (const category of [...savedCategories, ...categories]) {
        for (const entry of category.leaders || []) {
            if (entry.athlete?.displayName || entry.athlete?.fullName) {
                const id = athleteId(entry.athlete);
                athletes.set(id, { ...athletes.get(id), ...entry.athlete });
            }
        }
    }
    const rows = injuryRowsWithDepth(injuryRows, index), injuries = new Map();
    for (const row of rows) {
        const id = athleteId(row.athlete);
        athletes.set(id, { ...athletes.get(id), ...row.athlete });
        injuries.set(id, row);
    }
    function player(id, label, stats) {
        const athlete = athletes.get(id);
        if (!athlete?.displayName && !athlete?.fullName) return null;
        const injury = injuries.get(id), rawStatus = injuryStatus(injury);
        const status = ['active', 'healthy'].includes(String(rawStatus || '').toLowerCase()) ? null : rawStatus || null;
        const metrics = stats.flatMap(category => {
            const entry = categories.find(row => row.name === category)?.leaders?.find(row => athleteId(row.athlete) === id);
            return entry ? [{ label: statLabels[category], display: entry.displayValue || String(entry.value ?? '') }] : [];
        });
        return { id, name: athlete.displayName || athlete.fullName,
            position: index.athletes.get(id)?.position?.abbreviation || athlete.position?.abbreviation || '',
            headshot: typeof athlete.headshot === 'string' ? athlete.headshot : athlete.headshot?.href,
            label, status, availability: status || (reportAvailable ? 'No injury designation reported' : 'Injury status unavailable'),
            reason: injury?.details?.type || '', comment: injury?.shortComment || '', metrics, source: source(athlete) };
    }

    const listedFirst = index.quarterbacks[0];
    // Preserve an observed QB1's injury if this game's chart subsequently promotes
    // his backup. A current injury designation is required; history alone is not evidence.
    const previousStatus = injuryStatus(injuries.get(previousQuarterback?.id));
    const changedWhileOut = previousQuarterback?.id && previousQuarterback.id !== listedFirst &&
        (unavailable(previousStatus) || previousStatus.toLowerCase() === 'doubtful');
    const firstId = changedWhileOut ? previousQuarterback.id : listedFirst;
    const primary = firstId ? player(firstId, changedWhileOut ? 'Previously listed QB1' : 'QB1 · Depth-chart starter', ['passingLeader', 'quarterbackRating']) : null;
    let replacement = null, note = '';
    if (primary && (unavailable(primary.status) || String(primary.status).toLowerCase() === 'doubtful')) {
        const nextId = index.quarterbacks.filter(id => id !== firstId).find(id => !unavailable(injuryStatus(injuries.get(id))) &&
            String(injuryStatus(injuries.get(id))).toLowerCase() !== 'doubtful');
        replacement = nextId ? player(nextId, unavailable(primary.status) ? 'Expected QB · Next on depth chart' : 'Next QB · If QB1 cannot play',
            ['passingLeader', 'quarterbackRating']) : null;
        note = `${primary.name} is ${primary.status}. ${replacement ? `${replacement.name} is next available on ESPN’s depth chart; the game-day starter is not confirmed.` : 'No available replacement could be identified from the depth chart.'}`;
    } else if (primary?.status) {
        note = 'An injury designation does not confirm that QB1 will miss the game.';
    }
    const highlights = [];
    const addLeader = (category, label, extras = []) => {
        const entry = categories.find(row => row.name === category)?.leaders?.find(row => {
            const id = athleteId(row.athlete), status = injuryStatus(injuries.get(id));
            return index.starters.has(id) && index.starters.get(id) !== 'QB' && !unavailable(status) &&
                String(status || '').toLowerCase() !== 'doubtful' && !highlights.some(player => player.id === id) && Number(row.value ?? 1) > 0;
        });
        if (!entry) return false;
        const selected = player(athleteId(entry.athlete), label, [category, ...extras]);
        if (!selected) return false;
        highlights.push(selected);
        return true;
    };
    addLeader('receivingLeader', 'Starting receiver to watch');
    if (!addLeader('sacks', 'Starting defender to watch', ['totalTackles', 'interceptions'])) {
        if (!addLeader('totalTackles', 'Starting defender to watch', ['interceptions'])) addLeader('interceptions', 'Starting defender to watch');
    }
    if (highlights.length < 2) addLeader('rushingLeader', 'Starting rusher to watch');
    const contributors = majorContributors(categories);
    const contributorRoles = new Map(roles);
    for (const id of contributors.keys()) contributorRoles.set(id, 'Major season contributor');
    const ranked = rankInjuries(rows, depth, contributorRoles, contributors, previousQuarterback);
    const shown = new Set([primary?.id, replacement?.id, ...highlights.map(player => player.id)].filter(Boolean));
    return { quarterbacks: { primary, replacement, note, available: !!primary }, highlights: highlights.slice(0, 2),
        absences: keyAbsences(ranked, shown), injuries: ranked,
        reportAvailable, depthAvailable: index.starters.size > 0 };
}

function quarterbackHistory(context) {
    const primary = context?.quarterbacks?.primary;
    if (!primary) return null;
    return { name: primary.name, status: primary.status || primary.availability,
        unavailable: unavailable(primary.status), replacement: context.quarterbacks.replacement?.name || null,
        capturedAt: context.capturedAt, injuryUpdatedAt: context.injuryUpdatedAt };
}

module.exports = { buildPlayerContext, rankInjuries, depthChart, unavailable, quarterbackHistory };
