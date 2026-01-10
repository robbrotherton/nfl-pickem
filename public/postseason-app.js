// postseason-app.js
// UI prototype for NFL Postseason Predictor


import { getCurrentSeason, getCurrentWeek, getAllStandings, setAllStandings, setCurrentSeason, setAllGames } from './modules/state.js';
import { HOME_FIELD_ADVANTAGE, DIVISION_MAP } from './modules/constants.js';
import { fetchStandings } from './modules/api.js';
import { calculatePlayoffTeams } from './modules/playoff-calculator.js';



function buildBracketData(wildcardGames) {
    // Group by conference (not used yet, but could be useful)
    return [
        {
            round: 'Wild Card',
            games: wildcardGames
        },
        { round: 'Divisional', games: [null, null, null, null] },
        { round: 'Conference', games: [null, null] },
        { round: 'Super Bowl', games: [null] }
    ];
}

function getTeamsInContention(wildcardGames) {
    // Get all unique teams from the wildcard games (home and away)
    const teams = {};
    wildcardGames.forEach(g => {
        [
            { abbr: g.home_abbr, name: g.home_team, logo: g.home_logo },
            { abbr: g.away_abbr, name: g.away_team, logo: g.away_logo }
        ].forEach(t => {
            if (t.abbr && !teams[t.abbr]) teams[t.abbr] = t;
        });
    });
    return Object.values(teams);
}

function renderTeamSelector(teams, selectedAbbr, onSelect) {
    // Group teams by conference
    const nfcTeams = teams.filter(t => t.conference === 'NFC');
    const afcTeams = teams.filter(t => t.conference === 'AFC');

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.margin = '18px 0 24px 0';

    function makeRow(label, teams) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'center';
        row.style.gap = '18px';
        row.style.margin = '0 0 8px 0';
        const confLabel = document.createElement('span');
        confLabel.textContent = label;
        confLabel.style.fontWeight = 'bold';
        confLabel.style.marginRight = '12px';
        confLabel.style.alignSelf = 'center';
        row.appendChild(confLabel);
        teams.forEach(team => {
            const btn = document.createElement('button');
            btn.style.background = 'none';
            btn.style.border = 'none';
            btn.style.cursor = 'pointer';
            btn.style.padding = '0';
            btn.style.outline = 'none';
            btn.title = team.name || team.abbr;
            btn.innerHTML = `<img src="${team.logo}" alt="${team.abbr}" style="width:40px;height:40px;object-fit:contain;filter:${selectedAbbr===team.abbr?'drop-shadow(0 0 6px #1976d2)':''}"><br><span style="font-size:0.9em;color:${selectedAbbr===team.abbr?'#1976d2':'#333'};font-weight:${selectedAbbr===team.abbr?'bold':'normal'}">${team.abbr}</span>`;
            if (selectedAbbr === team.abbr) btn.style.borderBottom = '3px solid #1976d2';
            btn.onclick = () => onSelect(team.abbr);
            row.appendChild(btn);
        });
        return row;
    }
    if (nfcTeams.length) container.appendChild(makeRow('NFC', nfcTeams));
    if (afcTeams.length) container.appendChild(makeRow('AFC', afcTeams));
    return container;
}
function renderBracket(bracket, teams, selectedAbbr, onSelectTeam) {
    const app = document.getElementById('bracketApp');
    app.innerHTML = '';
    // Team selector row
    if (teams && teams.length) {
        app.appendChild(renderTeamSelector(teams, selectedAbbr, onSelectTeam));
    }
    const container = document.createElement('div');
    container.className = 'bracket-container';
    bracket.forEach(round => {
        const col = document.createElement('div');
        col.className = 'bracket-round';
        col.innerHTML = `<h3>${round.round}</h3>`;
        round.games.forEach(game => {
            if (!game) {
                col.innerHTML += `<div class=\"placeholder\">TBD</div>`;
            } else {
                col.innerHTML += renderGameCard(game);
            }
        });
        container.appendChild(col);
    });
    app.appendChild(container);
    document.getElementById('resetProbBtn').style.display = 'block';
}



// Fetch scheduled playoff games from local DB (restoring original logic)
async function fetchPlayoffGames(season, week) {
    // Use ?playoff=1 to ensure only playoff games are loaded for week 1
    const res = await fetch(`/api/games/${season}/${week}?playoff=1`);
    return res.json();
}

function getHomeWinProb(game) {
    // Use the same logic as simulation.js for weighted probability
    const allStandings = getAllStandings ? getAllStandings() : [];
    const homeTeam = allStandings.find(t => t.abbr === game.home_abbr);
    const awayTeam = allStandings.find(t => t.abbr === game.away_abbr);
    const homeWinPct = homeTeam?.winPct ?? 0.5;
    const awayWinPct = awayTeam?.winPct ?? 0.5;
    const totalWeight = homeWinPct + awayWinPct;
    let homeProb = totalWeight > 0 ? (homeWinPct / totalWeight) + HOME_FIELD_ADVANTAGE : 0.5 + HOME_FIELD_ADVANTAGE;
    // Clamp between 0 and 1
    homeProb = Math.max(0, Math.min(1, homeProb));
    console.log(`[Bracket] Home win prob for ${game.home_abbr} vs ${game.away_abbr}:`, {
        homeTeam, awayTeam, homeWinPct, awayWinPct, homeProb, totalWeight
    });
    return Math.round(homeProb * 100);
}

function renderGameCard(game) {
    const isFinal = game.status === 'final';
    // Default slider value: use userProbability if set, else use win/loss record logic
    const defaultProb = game.userProbability ?? getHomeWinProb(game);
    return `<div class="game-card${isFinal ? ' final' : ''}">
        <div class="teams">
            <div class="team"><img src="${game.away_logo}" alt="${game.away_abbr}"> ${game.away_abbr}</div>
            <span>at</span>
            <div class="team"><img src="${game.home_logo}" alt="${game.home_abbr}"> ${game.home_abbr}</div>
        </div>
        ${isFinal ? `<div class="score">${game.away_score} - ${game.home_score}</div>` :
        `<div class="slider-row">
            <label style="flex:1;">${game.home_abbr} win %</label>
            <input type="range" min="0" max="100" value="${defaultProb}" data-gameid="${game.id}" class="prob-slider">
            <span class="prob-label">${defaultProb}%</span>
        </div>`}
    </div>`;
}

function setupSliderEvents(bracket) {
    document.querySelectorAll('.prob-slider').forEach(slider => {
        slider.addEventListener('input', e => {
            const val = e.target.value;
            e.target.parentElement.querySelector('.prob-label').textContent = val + '%';
            // Store in bracket data (not persistent yet)
            const gameId = e.target.getAttribute('data-gameid');
            for (const round of bracket) {
                for (const game of round.games) {
                    if (game && game.id === gameId) game.userProbability = Number(val);
                }
            }
        });
    });
}

function setupResetButton(bracket) {
    document.getElementById('resetProbBtn').onclick = () => {
        for (const round of bracket) {
            for (const game of round.games) {
                if (game && game.status !== 'final') game.userProbability = 50;
            }
        }
        renderBracket(bracket);
        setupSliderEvents(bracket);
        setupResetButton(bracket);
    };
}


async function main() {
    // Auto-detect the latest season with games in the DB
    try {
        // 1. Fetch current season/week info (from ESPN, like playoff tree page)
        const api = await import('./modules/api.js');
        await api.fetchCurrentSeasonInfo();

        // 2. Fetch ESPN-style standings (weeks 1-18, with clincher status, etc.)
        const standings = await api.fetchStandings();
        setAllStandings(standings);

        // 3. Fetch scheduled playoff games from DB (still from your DB)
        const season = standings[0]?.season || (await (await fetch('/api/seasons')).json())[0];
        const week = 1; // Wild Card round
        const games = await fetchPlayoffGames(season, week);
        console.log('[Postseason] Fetched games:', games);
        if (!Array.isArray(games)) {
            document.getElementById('bracketApp').innerHTML = '<div class="error">DB returned invalid data (not an array).</div>';
            return;
        }
        if (!games.length) {
            document.getElementById('bracketApp').innerHTML = '<div class="error">No playoff games found for this round.</div>';
            return;
        }
        setAllGames(games);

        // 4. Fetch tiebreaker records before calculating playoff teams/seeds
        await import('./modules/tiebreakers.js').then(mod => mod.fetchTiebreakRecords && mod.fetchTiebreakRecords());
        const nfcStandings = standings.filter(t => t.conference === 'NFC');
        const afcStandings = standings.filter(t => t.conference === 'AFC');
        let nfcPlayoffTeams = calculatePlayoffTeams(nfcStandings).map(t => ({ ...t, conference: 'NFC' }));
        let afcPlayoffTeams = calculatePlayoffTeams(afcStandings).map(t => ({ ...t, conference: 'AFC' }));
        // Defensive: If fewer than 7 teams, fill with next best teams by winPct
        if (nfcPlayoffTeams.length < 7) {
            const missing = 7 - nfcPlayoffTeams.length;
            const extras = nfcStandings
                .filter(t => !nfcPlayoffTeams.find(pt => pt.abbr === t.abbr))
                .sort((a, b) => b.winPct - a.winPct)
                .slice(0, missing)
                .map(t => ({ ...t, conference: 'NFC', isWildCard: true }));
            nfcPlayoffTeams = nfcPlayoffTeams.concat(extras);
        }
        if (afcPlayoffTeams.length < 7) {
            const missing = 7 - afcPlayoffTeams.length;
            const extras = afcStandings
                .filter(t => !afcPlayoffTeams.find(pt => pt.abbr === t.abbr))
                .sort((a, b) => b.winPct - a.winPct)
                .slice(0, missing)
                .map(t => ({ ...t, conference: 'AFC', isWildCard: true }));
            afcPlayoffTeams = afcPlayoffTeams.concat(extras);
        }
        nfcPlayoffTeams = nfcPlayoffTeams.slice(0, 7);
        afcPlayoffTeams = afcPlayoffTeams.slice(0, 7);
        const teams = [...nfcPlayoffTeams, ...afcPlayoffTeams];
        let selectedAbbr = teams.length ? teams[0].abbr : null;
        const bracket = buildBracketData(games);
        function rerender() {
            renderBracket(bracket, teams, selectedAbbr, abbr => {
                selectedAbbr = abbr;
                rerender();
            });
            setupSliderEvents(bracket);
            setupResetButton(bracket);
        }
        rerender();
    } catch (e) {
        document.getElementById('bracketApp').innerHTML = `<div class="error">Failed to load playoff games from DB: ${e && e.message ? e.message : e}</div>`;
        console.error('[Postseason] Error loading playoff games:', e);
    }
}

main();
