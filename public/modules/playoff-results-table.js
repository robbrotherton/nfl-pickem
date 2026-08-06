// playoff-results-table.js
// Renders a table of playoff simulation results

/**
 * Render a results table showing each team's probability of reaching each round and winning the Super Bowl.
 * @param {Array} teams - Array of team objects (with abbr, name, logo, etc.)
 * @param {Object} teamStats - { abbr: { WC, Div, Conf, SB, Champ } }
 * @param {HTMLElement} container - DOM element to render into
 */
export function renderPlayoffResultsTable(teams, teamStats, container) {
    // Sort teams by probability of winning Super Bowl, then by seed
    const sorted = teams.slice().sort((a, b) => {
        const aChamp = teamStats[a.abbr]?.Champ || 0;
        const bChamp = teamStats[b.abbr]?.Champ || 0;
        if (bChamp !== aChamp) return bChamp - aChamp;
        return (a.seed || 99) - (b.seed || 99);
    });
    
    const roundLabels = ['WC', 'Div', 'Conf', 'SB', 'Champ'];
    const roundNames = ['Wild Card', 'Divisional', 'Conference', 'Super Bowl', 'Champion'];
    
    let html = `<table class="playoff-results-table">
        <thead>
            <tr>
                <th>Team</th>
                <th>Seed</th>
                <th>Logo</th>
                ${roundNames.map(r => `<th>${r}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
    `;
    for (const team of sorted) {
        const stats = teamStats[team.abbr] || {};
        html += `<tr>
            <td>${team.name || team.abbr}</td>
            <td>${team.seed || ''}</td>
            <td><img src="${team.logo}" alt="${team.abbr}" style="width:32px;height:32px;object-fit:contain;"></td>
            ${roundLabels.map(r => `<td>${(stats[r] * 100).toFixed(1)}%</td>`).join('')}
        </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}
