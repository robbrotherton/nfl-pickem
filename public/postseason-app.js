// postseason-app.js
// UI prototype for NFL Postseason Predictor


import { getCurrentSeason, getCurrentWeek, getAllStandings, setAllStandings, setAllGames } from './modules/state.js';
import { HOME_FIELD_ADVANTAGE, DIVISION_MAP } from './modules/constants.js';
import { fetchDbSeasonData } from './modules/api.js';
import { calculatePlayoffTeams } from './modules/playoff-calculator.js';



function buildBracketData(wildcardGames, teams) {
    // Assign seeds and conferences to each game using the teams array
    const teamMap = {};
    teams.forEach(t => {
        teamMap[t.abbr] = { seed: t.seed, conference: t.conference };
    });
    const gamesWithSeeds = wildcardGames.map(g => ({
        ...g,
        home_seed: teamMap[g.home_abbr]?.seed,
        away_seed: teamMap[g.away_abbr]?.seed,
        home_conference: teamMap[g.home_abbr]?.conference,
        away_conference: teamMap[g.away_abbr]?.conference
    }));
    // Separate by conference
    const nfcGames = gamesWithSeeds.filter(g => g.home_conference === 'NFC' || g.away_conference === 'NFC');
    const afcGames = gamesWithSeeds.filter(g => g.home_conference === 'AFC' || g.away_conference === 'AFC');
    // Order by lower seed (should be 2v7, 3v6, 4v5)
    function orderGamesBySeed(games) {
        return [2,3,4].map(seed =>
            games.find(g => (g.home_seed === seed && g.away_seed === 7-seed+2) || (g.away_seed === seed && g.home_seed === 7-seed+2))
        ).filter(Boolean);
    }
    const orderedNfc = orderGamesBySeed(nfcGames);
    const orderedAfc = orderGamesBySeed(afcGames);
    const orderedGames = [...orderedNfc, ...orderedAfc];
    return [
        {
            round: 'Wild Card',
            games: orderedGames
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
        // 1. Fetch standings from DB (regular season only)
        const { standings } = await fetchDbSeasonData();
        setAllStandings(standings);

        // 3. Fetch scheduled playoff games from DB (still from your DB)
        const season = getCurrentSeason() || (await (await fetch('/api/seasons')).json())[0];
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
        // Add winPct to each team (already present from standings, but ensure it's there)
        const teams = [...nfcPlayoffTeams, ...afcPlayoffTeams].map(t => ({
            ...t,
            winPct: typeof t.winPct === 'number' ? t.winPct : 0
        }));
                // Function to compute matchup probability based on two teams' winPct
                function getRecordBasedProb(home, away) {
                    const homeWinPct = home.winPct ?? 0.5;
                    const awayWinPct = away.winPct ?? 0.5;
                    const total = homeWinPct + awayWinPct;
                    if (total === 0) return 0.5;
                    return homeWinPct / total;
                }
        let selectedAbbr = teams.length ? teams[0].abbr : null;
        const bracket = buildBracketData(games, teams);
        // --- Simulation UI ---
        let simResultsContainer = document.getElementById('simResultsContainer');
        if (!simResultsContainer) {
            simResultsContainer = document.createElement('div');
            simResultsContainer.id = 'simResultsContainer';
            simResultsContainer.style.margin = '32px 0';
            document.body.appendChild(simResultsContainer);
        }
        let simButton = document.getElementById('runSimButton');
        if (!simButton) {
            simButton = document.createElement('button');
            simButton.id = 'runSimButton';
            simButton.textContent = 'Run Playoff Simulator';
            simButton.style.margin = '24px auto 12px auto';
            simButton.style.display = 'block';
            document.body.appendChild(simButton);
        }


        // --- Patch: Use userProbability (slider value) for each matchup in the sim ---
        // Build a lookup for user-set probabilities from the bracket
        function buildUserProbMap(bracket, teams) {
            const probMap = {};
            // Build a lookup for team seeds and conferences
            const seedMap = {};
            const confMap = {};
            for (const t of teams) {
                seedMap[t.abbr] = t.seed;
                confMap[t.abbr] = t.conference;
            }
            for (const round of bracket) {
                for (const game of round.games) {
                    if (game && game.home_abbr && game.away_abbr && typeof game.userProbability === 'number') {
                        const homeSeed = seedMap[game.home_abbr];
                        const awaySeed = seedMap[game.away_abbr];
                        const homeConf = confMap[game.home_abbr];
                        const awayConf = confMap[game.away_abbr];
                        // Use the conference of the lower seed (should always be the same for wild card)
                        const conf = homeSeed < awaySeed ? homeConf : awayConf;
                        if (typeof homeSeed === 'number' && typeof awaySeed === 'number' && conf) {
                            const highSeed = homeSeed < awaySeed ? game.home_abbr : game.away_abbr;
                            const lowSeed = homeSeed < awaySeed ? game.away_abbr : game.home_abbr;
                            const highSeedNum = homeSeed < awaySeed ? homeSeed : awaySeed;
                            const lowSeedNum = homeSeed < awaySeed ? awaySeed : homeSeed;
                            const prob = homeSeed < awaySeed ? (game.userProbability / 100) : (1 - game.userProbability / 100);
                            const key = `${conf}_${highSeedNum}_${lowSeedNum}`;
                            probMap[key] = prob;
                            console.log('[Sim][buildUserProbMap] Game:', {
                                home_abbr: game.home_abbr,
                                away_abbr: game.away_abbr,
                                homeSeed,
                                awaySeed,
                                userProbability: game.userProbability,
                                highSeed,
                                lowSeed,
                                highSeedNum,
                                lowSeedNum,
                                conf,
                                prob,
                                key
                            });
                        }
                    }
                }
            }
            console.log('[Sim][buildUserProbMap] Final probMap:', probMap);
            return probMap;
        }

        async function runSimulation() {
            simButton.disabled = true;
            simButton.textContent = 'Simulating...';
            simResultsContainer.innerHTML = '';
            const [sim, table] = await Promise.all([
                import('./modules/playoff-simulator.js'),
                import('./modules/playoff-results-table.js')
            ]);
            // Build user probability map from current bracket
            const userProbMap = buildUserProbMap(bracket, teams);
            // getGameProb uses userProbability based on seed order, else falls back to winPct
            const seedMap = {};
            const confMap = {};
            for (const t of teams) {
                seedMap[t.abbr] = t.seed;
                confMap[t.abbr] = t.conference;
            }
            function getGameProb(home, away) {
                const homeSeed = seedMap[home.abbr];
                const awaySeed = seedMap[away.abbr];
                const homeConf = confMap[home.abbr];
                const awayConf = confMap[away.abbr];
                // Use the conference of the lower seed (should always be the same for wild card)
                const conf = homeSeed < awaySeed ? homeConf : awayConf;
                if (typeof homeSeed === 'number' && typeof awaySeed === 'number' && conf) {
                    const highSeed = homeSeed < awaySeed ? home.abbr : away.abbr;
                    const lowSeed = homeSeed < awaySeed ? away.abbr : home.abbr;
                    const highSeedNum = homeSeed < awaySeed ? homeSeed : awaySeed;
                    const lowSeedNum = homeSeed < awaySeed ? awaySeed : homeSeed;
                    const key = `${conf}_${highSeedNum}_${lowSeedNum}`;
                    if (userProbMap.hasOwnProperty(key)) {
                        // Always return probability for higher seed as home
                        const prob = highSeed === home.abbr ? userProbMap[key] : 1 - userProbMap[key];
                        console.log('[Sim][getGameProb] Matchup:', {
                            home: home.abbr,
                            away: away.abbr,
                            homeSeed,
                            awaySeed,
                            highSeed,
                            lowSeed,
                            highSeedNum,
                            lowSeedNum,
                            conf,
                            key,
                            userProb: userProbMap[key],
                            returnedProb: prob
                        });
                        return prob;
                    } else {
                        console.log('[Sim][getGameProb] No userProb for', key, 'Matchup:', {
                            home: home.abbr,
                            away: away.abbr,
                            homeSeed,
                            awaySeed,
                            conf
                        });
                    }
                }
                // Fallback: winPct-based
                const homeWinPct = home.winPct ?? 0.5;
                const awayWinPct = away.winPct ?? 0.5;
                const totalWeight = homeWinPct + awayWinPct;
                let homeProb = totalWeight > 0 ? (homeWinPct / totalWeight) + HOME_FIELD_ADVANTAGE : 0.5 + HOME_FIELD_ADVANTAGE;
                console.log('[Sim][getGameProb] Fallback winPct for', home.abbr, 'vs', away.abbr, ':', homeProb);
                return Math.max(0, Math.min(1, homeProb));
            }
            const { teamStats } = sim.runPlayoffSimulations(teams, getGameProb, 10000);
            table.renderPlayoffResultsTable(teams, teamStats, simResultsContainer);
            simButton.disabled = false;
            simButton.textContent = 'Run Playoff Simulator';
        }
        simButton.onclick = runSimulation;

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
