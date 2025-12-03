// NFL Playoff Scenario Calculator
// Standalone test version - uses ESPN API directly

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
let TARGET_TEAM = 'CHI'; // Default to Chicago Bears
const CURRENT_SEASON = 2025; // 2025 season
const CURRENT_WEEK = 14; // We're in week 14, looking at remaining games

// Global state
let nfcStandings = [];
let allGames = [];
let criticalGames = [];
let userOutcomes = {}; // gameId -> 'home' or 'away'

// ========================================
// INITIALIZATION
// ========================================

window.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
});

async function initializeApp() {
    try {
        console.log('🏈 Starting playoff calculator...');
        
        // Fetch data from ESPN
        await fetchNFCStandings();
        await fetchRemainingGames();
        
        // Identify critical games
        identifyCriticalGames();
        
        // Render the UI
        renderApp();
        
        // Calculate initial scenarios
        calculateAndDisplayScenarios();
        
    } catch (error) {
        console.error('Error initializing app:', error);
        document.getElementById('app').innerHTML = `
            <div class="error">
                <strong>Error loading data:</strong> ${error.message}
                <br><br>
                Check the console (F12) for details.
            </div>
        `;
    }
}

// ========================================
// DATA FETCHING
// ========================================

async function fetchNFCStandings() {
    console.log('📊 Fetching NFC standings...');
    
    // Build standings from scoreboard data (weeks 1-current)
    const teamMap = new Map();
    
    // Fetch all weeks so far to build current standings
    for (let week = 1; week <= CURRENT_WEEK; week++) {
        const response = await fetch(`${ESPN_API_BASE}/scoreboard?seasontype=2&week=${week}`);
        const data = await response.json();
        
        if (data.events) {
            data.events.forEach(event => {
                const competition = event.competitions[0];
                const homeTeam = competition.competitors.find(t => t.homeAway === 'home');
                const awayTeam = competition.competitors.find(t => t.homeAway === 'away');
                
                // Store team info (will get updated each week with latest record)
                [homeTeam, awayTeam].forEach(competitor => {
                    const team = competitor.team;
                    const record = competitor.records?.[0];
                    
                    if (record) {
                        const [wins, losses, ties = 0] = record.summary.split('-').map(n => parseInt(n) || 0);
                        
                        teamMap.set(team.abbreviation, {
                            id: team.id,
                            name: team.displayName,
                            abbr: team.abbreviation,
                            logo: team.logo,
                            location: team.location,
                            wins,
                            losses,
                            ties,
                            winPct: wins / (wins + losses + ties)
                        });
                    }
                });
            });
        }
    }
    
    // Convert map to array and filter to NFC teams
    // NFC teams: NFC North (CHI, DET, GB, MIN), NFC South (ATL, CAR, NO, TB), 
    //            NFC East (DAL, NYG, PHI, WAS), NFC West (ARI, LA, SF, SEA)
    const nfcTeamAbbrs = [
        // NFC North
        'CHI', 'DET', 'GB', 'MIN',
        // NFC South
        'ATL', 'CAR', 'NO', 'TB',
        // NFC East
        'DAL', 'NYG', 'PHI', 'WAS',
        // NFC West
        'ARI', 'LAR', 'SF', 'SEA'
    ];
    
    const divisionMap = {
        'CHI': 'NFC North', 'DET': 'NFC North', 'GB': 'NFC North', 'MIN': 'NFC North',
        'ATL': 'NFC South', 'CAR': 'NFC South', 'NO': 'NFC South', 'TB': 'NFC South',
        'DAL': 'NFC East', 'NYG': 'NFC East', 'PHI': 'NFC East', 'WAS': 'NFC East',
        'ARI': 'NFC West', 'LAR': 'NFC West', 'SF': 'NFC West', 'SEA': 'NFC West'
    };
    
    nfcStandings = Array.from(teamMap.values())
        .filter(team => nfcTeamAbbrs.includes(team.abbr))
        .map(team => ({
            ...team,
            division: divisionMap[team.abbr] || 'NFC Unknown'
        }));
    
    // Sort by wins (descending)
    nfcStandings.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return 0;
    });
    
    console.log(`✅ Loaded ${nfcStandings.length} NFC teams`);
    console.log('Top 5 teams:', nfcStandings.slice(0, 5).map(t => `${t.abbr} ${t.wins}-${t.losses}`).join(', '));
}

async function fetchRemainingGames() {
    console.log('📅 Fetching remaining schedule...');
    
    allGames = [];
    
    // Fetch remaining weeks (current week + future weeks through week 18)
    for (let week = CURRENT_WEEK; week <= 18; week++) {
        const response = await fetch(`${ESPN_API_BASE}/scoreboard?seasontype=2&week=${week}`);
        const data = await response.json();
        
        if (data.events) {
            data.events.forEach(event => {
                const competition = event.competitions[0];
                const homeTeam = competition.competitors.find(t => t.homeAway === 'home');
                const awayTeam = competition.competitors.find(t => t.homeAway === 'away');
                
                // Only include games that haven't been played yet
                const status = competition.status.type.state;
                if (status === 'pre') {
                    allGames.push({
                        id: event.id,
                        week: week,
                        date: new Date(event.date),
                        homeTeam: {
                            id: homeTeam.team.id,
                            abbr: homeTeam.team.abbreviation,
                            name: homeTeam.team.displayName,
                            logo: homeTeam.team.logo,
                            record: homeTeam.records?.[0]?.summary || '0-0'
                        },
                        awayTeam: {
                            id: awayTeam.team.id,
                            abbr: awayTeam.team.abbreviation,
                            name: awayTeam.team.displayName,
                            logo: awayTeam.team.logo,
                            record: awayTeam.records?.[0]?.summary || '0-0'
                        }
                    });
                }
            });
        }
    }
    
    console.log(`✅ Loaded ${allGames.length} remaining games`);
}

// ========================================
// GAME FILTERING
// ========================================

function identifyCriticalGames() {
    console.log('🎯 Identifying critical games...');
    
    const targetTeam = nfcStandings.find(t => t.abbr === TARGET_TEAM);
    const targetDivision = targetTeam?.division || 'NFC North';
    const divisionTeams = nfcStandings.filter(t => t.division === targetDivision);
    
    criticalGames = allGames.filter(game => {
        const homeIsNFC = nfcStandings.some(t => t.abbr === game.homeTeam.abbr);
        const awayIsNFC = nfcStandings.some(t => t.abbr === game.awayTeam.abbr);
        
        // Skip games with no NFC teams
        if (!homeIsNFC && !awayIsNFC) return false;
        
        const homeInDivision = divisionTeams.some(t => t.abbr === game.homeTeam.abbr);
        const awayInDivision = divisionTeams.some(t => t.abbr === game.awayTeam.abbr);
        
        // Priority 1: Target team games
        if (game.homeTeam.abbr === TARGET_TEAM || game.awayTeam.abbr === TARGET_TEAM) {
            return true;
        }
        
        // Priority 2: Division games
        if (homeInDivision && awayInDivision) {
            return true;
        }
        
        // Priority 3: Division teams vs anyone in NFC
        if ((homeInDivision && awayIsNFC) || (awayInDivision && homeIsNFC)) {
            return true;
        }
        
        // Priority 4: Wild card contenders (teams within 3 games of 7th place)
        const seventhPlace = nfcStandings[6];
        if (seventhPlace) {
            const homeTeamStanding = nfcStandings.find(t => t.abbr === game.homeTeam.abbr);
            const awayTeamStanding = nfcStandings.find(t => t.abbr === game.awayTeam.abbr);
            
            const homeInContention = homeTeamStanding && 
                Math.abs(homeTeamStanding.wins - seventhPlace.wins) <= 3;
            const awayInContention = awayTeamStanding && 
                Math.abs(awayTeamStanding.wins - seventhPlace.wins) <= 3;
            
            if (homeInContention && awayInContention) {
                return true;
            }
        }
        
        return false;
    });
    
    // Add impact scores
    criticalGames.forEach(game => {
        game.impact = calculateGameImpact(game);
    });
    
    // Sort by impact (highest first)
    criticalGames.sort((a, b) => b.impact.score - a.impact.score);
    
    console.log(`✅ Identified ${criticalGames.length} critical games`);
}

function calculateGameImpact(game) {
    let score = 0;
    let label = 'Low';
    
    const targetTeam = nfcStandings.find(t => t.abbr === TARGET_TEAM);
    const targetDivision = targetTeam?.division || 'NFC North';
    
    // Target team game = highest priority
    if (game.homeTeam.abbr === TARGET_TEAM || game.awayTeam.abbr === TARGET_TEAM) {
        score = 100;
        label = 'Critical';
    }
    // Both teams in target's division
    else if (nfcStandings.find(t => t.abbr === game.homeTeam.abbr)?.division === targetDivision &&
             nfcStandings.find(t => t.abbr === game.awayTeam.abbr)?.division === targetDivision) {
        score = 80;
        label = 'High';
    }
    // One team in target's division
    else if (nfcStandings.find(t => t.abbr === game.homeTeam.abbr)?.division === targetDivision ||
             nfcStandings.find(t => t.abbr === game.awayTeam.abbr)?.division === targetDivision) {
        score = 60;
        label = 'Medium';
    }
    // Both teams wild card contenders
    else {
        score = 40;
        label = 'Medium';
    }
    
    return { score, label };
}

// ========================================
// PLAYOFF CALCULATION
// ========================================

function calculatePlayoffTeams(standings) {
    // Group by division
    const divisions = {
        'NFC North': [],
        'NFC South': [],
        'NFC East': [],
        'NFC West': []
    };
    
    standings.forEach(team => {
        if (divisions[team.division]) {
            divisions[team.division].push(team);
        }
    });
    
    // Get division winners (best record in each division)
    const divisionWinners = [];
    Object.keys(divisions).forEach(div => {
        const sorted = divisions[div].sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (a.losses !== b.losses) return a.losses - b.losses;
            return 0;
        });
        if (sorted[0]) {
            divisionWinners.push({ ...sorted[0], isDivisionWinner: true });
        }
    });
    
    // Sort division winners by record
    divisionWinners.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return 0;
    });
    
    // Get wild card teams (best remaining teams)
    const wildCardPool = standings.filter(team => 
        !divisionWinners.find(dw => dw.id === team.id)
    );
    
    wildCardPool.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return 0;
    });
    
    const wildCards = wildCardPool.slice(0, 3).map(team => ({ ...team, isWildCard: true }));
    
    // Combine and assign seeds
    const playoffTeams = [...divisionWinners, ...wildCards];
    playoffTeams.forEach((team, index) => {
        team.seed = index + 1;
    });
    
    return playoffTeams;
}

function simulateScenario(outcomes) {
    // Clone current standings
    const standings = JSON.parse(JSON.stringify(nfcStandings));
    
    // Apply outcomes to update records
    criticalGames.forEach(game => {
        const outcome = outcomes[game.id];
        if (outcome) {
            const winner = outcome === 'home' ? game.homeTeam.abbr : game.awayTeam.abbr;
            const loser = outcome === 'home' ? game.awayTeam.abbr : game.homeTeam.abbr;
            
            const winnerTeam = standings.find(t => t.abbr === winner);
            const loserTeam = standings.find(t => t.abbr === loser);
            
            if (winnerTeam) {
                winnerTeam.wins++;
                winnerTeam.winPct = winnerTeam.wins / (winnerTeam.wins + winnerTeam.losses);
            }
            if (loserTeam) {
                loserTeam.losses++;
                loserTeam.winPct = loserTeam.wins / (loserTeam.wins + loserTeam.losses);
            }
        }
    });
    
    // Calculate playoff teams
    const playoffTeams = calculatePlayoffTeams(standings);
    
    // Check if Bears made it
    const bearsMadePlayoffs = playoffTeams.some(t => t.abbr === TARGET_TEAM);
    const bearsSeed = playoffTeams.find(t => t.abbr === TARGET_TEAM)?.seed || null;
    
    // Calculate Bears' position in division
    const bearsTeam = standings.find(t => t.abbr === TARGET_TEAM);
    const divisionTeams = standings.filter(t => t.division === bearsTeam.division)
        .sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (a.losses !== b.losses) return a.losses - b.losses;
            return 0;
        });
    const bearsDivisionRank = divisionTeams.findIndex(t => t.abbr === TARGET_TEAM) + 1;
    
    // Calculate Bears' position in wildcard race (among non-division winners)
    const divisionWinners = playoffTeams.filter(t => t.seed <= 4);
    const wildCardPool = standings.filter(team => 
        !divisionWinners.find(dw => dw.id === team.id)
    ).sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return 0;
    });
    const bearsWildcardRank = wildCardPool.findIndex(t => t.abbr === TARGET_TEAM) + 1;
    
    return {
        standings,
        playoffTeams,
        bearsMadePlayoffs,
        bearsSeed,
        bearsDivisionRank,
        bearsWildcardRank
    };
}

// ========================================
// SCENARIO GENERATION
// ========================================

function calculateAndDisplayScenarios() {
    console.log('🔮 Calculating scenarios...');
    
    // Monte Carlo simulation: sample random outcomes
    const numSamples = 1000;
    let bearsPlayoffCount = 0;
    const seedCounts = {};
    
    for (let i = 0; i < numSamples; i++) {
        // Generate random outcomes for undecided games
        const outcomes = { ...userOutcomes };
        
        criticalGames.forEach(game => {
            if (!outcomes[game.id]) {
                outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
            }
        });
        
        const result = simulateScenario(outcomes);
        
        if (result.bearsMadePlayoffs) {
            bearsPlayoffCount++;
            seedCounts[result.bearsSeed] = (seedCounts[result.bearsSeed] || 0) + 1;
        }
    }
    
    const playoffProbability = (bearsPlayoffCount / numSamples) * 100;
    
    console.log(`✅ Bears make playoffs in ${bearsPlayoffCount}/${numSamples} scenarios (${playoffProbability.toFixed(1)}%)`);
    
    // Find best and worst case scenarios
    const bestCase = findBestCaseScenario();
    const worstCase = findWorstCaseScenario();
    
    // Update display
    updatePlayoffChancesDisplay(playoffProbability, bearsPlayoffCount, numSamples, bestCase, worstCase);
    updateBestCaseDisplay(bestCase);
}

function findBestCaseScenario() {
    // Get all undecided games (not locked by user)
    const undecidedGames = criticalGames.filter(g => !userOutcomes[g.id]);
    
    // Use brute force only for very small scenarios
    const maxBruteForce = 14; // 2^14 = 16,384 combinations (fast)
    
    if (undecidedGames.length <= maxBruteForce) {
        // Brute force all combinations
        let bestResult = null;
        let bestOutcomes = null;
        const numCombinations = Math.pow(2, undecidedGames.length);
        
        for (let i = 0; i < numCombinations; i++) {
            const outcomes = { ...userOutcomes };
            
            undecidedGames.forEach((game, index) => {
                const bit = (i >> index) & 1;
                outcomes[game.id] = bit === 0 ? 'home' : 'away';
            });
            
            const result = simulateScenario(outcomes);
            
            if (!bestResult || 
                (result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs) ||
                (result.bearsMadePlayoffs && bestResult.bearsMadePlayoffs && result.bearsSeed < bestResult.bearsSeed) ||
                (!result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs && 
                 (result.bearsWildcardRank < bestResult.bearsWildcardRank || result.bearsDivisionRank < bestResult.bearsDivisionRank))) {
                bestResult = result;
                bestOutcomes = outcomes;
            }
        }
        
        return {
            outcomes: bestOutcomes,
            result: bestResult,
            gamesSet: criticalGames.filter(g => bestOutcomes[g.id]).map(g => ({
                ...g,
                selectedWinner: bestOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
            }))
        };
    }
    
    // For larger scenarios, use multiple strategic approaches
    const bearsGames = undecidedGames.filter(g => 
        g.homeTeam.abbr === TARGET_TEAM || g.awayTeam.abbr === TARGET_TEAM
    );
    
    // Get division rivals (other teams in same division)
    const targetTeam = nfcStandings.find(t => t.abbr === TARGET_TEAM);
    const targetDivision = targetTeam?.division || 'NFC North';
    const divisionRivals = nfcStandings
        .filter(t => t.division === targetDivision && t.abbr !== TARGET_TEAM)
        .map(t => t.abbr);
    
    const otherGames = undecidedGames.filter(g => 
        g.homeTeam.abbr !== TARGET_TEAM && g.awayTeam.abbr !== TARGET_TEAM
    );
    
    let bestResult = null;
    let bestOutcomes = null;
    
    // Strategy 1: Target team wins all, rivals lose all, others random (3000 samples)
    for (let i = 0; i < 3000; i++) {
        const outcomes = { ...userOutcomes };
        
        bearsGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === TARGET_TEAM ? 'home' : 'away';
        });
        
        otherGames.forEach(game => {
            if (divisionRivals.includes(game.homeTeam.abbr)) {
                outcomes[game.id] = 'away';
            } else if (divisionRivals.includes(game.awayTeam.abbr)) {
                outcomes[game.id] = 'home';
            } else {
                outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
            }
        });
        
        const result = simulateScenario(outcomes);
        
        if (!bestResult || 
            (result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs) ||
            (result.bearsMadePlayoffs && bestResult.bearsMadePlayoffs && result.bearsSeed < bestResult.bearsSeed) ||
            (!result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs && 
             (result.bearsWildcardRank < bestResult.bearsWildcardRank || result.bearsDivisionRank < bestResult.bearsDivisionRank))) {
            bestResult = result;
            bestOutcomes = outcomes;
        }
    }
    
    // Strategy 2: All non-Bears games favor higher seeds losing (helps wildcard chances)
    for (let i = 0; i < 1000; i++) {
        const outcomes = { ...userOutcomes };
        
        bearsGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === TARGET_TEAM ? 'home' : 'away';
        });
        
        otherGames.forEach(game => {
            // Favor upsets - helps Bears wildcard chances
            outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
        });
        
        const result = simulateScenario(outcomes);
        
        if (!bestResult || 
            (result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs) ||
            (result.bearsMadePlayoffs && bestResult.bearsMadePlayoffs && result.bearsSeed < bestResult.bearsSeed) ||
            (!result.bearsMadePlayoffs && !bestResult.bearsMadePlayoffs && 
             (result.bearsWildcardRank < bestResult.bearsWildcardRank || result.bearsDivisionRank < bestResult.bearsDivisionRank))) {
            bestResult = result;
            bestOutcomes = outcomes;
        }
    }
    
    return {
        outcomes: bestOutcomes,
        result: bestResult,
        gamesSet: criticalGames.filter(g => bestOutcomes[g.id]).map(g => ({
            ...g,
            selectedWinner: bestOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
        }))
    };
}

function findWorstCaseScenario() {
    // Get all undecided games (not locked by user)
    const undecidedGames = criticalGames.filter(g => !userOutcomes[g.id]);
    
    const maxBruteForce = 14; // 2^14 = 16,384 combinations (fast)
    
    if (undecidedGames.length <= maxBruteForce) {
        // Brute force all combinations
        let worstResult = null;
        let worstOutcomes = null;
        const numCombinations = Math.pow(2, undecidedGames.length);
        
        for (let i = 0; i < numCombinations; i++) {
            const outcomes = { ...userOutcomes };
            
            undecidedGames.forEach((game, index) => {
                const bit = (i >> index) & 1;
                outcomes[game.id] = bit === 0 ? 'home' : 'away';
            });
            
            const result = simulateScenario(outcomes);
            
            if (!worstResult || 
                (!result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs) ||
                (result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs && result.bearsSeed > worstResult.bearsSeed) ||
                (!result.bearsMadePlayoffs && !worstResult.bearsMadePlayoffs && 
                 (result.bearsWildcardRank > worstResult.bearsWildcardRank || result.bearsDivisionRank > worstResult.bearsDivisionRank))) {
                worstResult = result;
                worstOutcomes = outcomes;
            }
        }
        
        return {
            outcomes: worstOutcomes,
            result: worstResult,
            gamesSet: criticalGames.filter(g => worstOutcomes[g.id]).map(g => ({
                ...g,
                selectedWinner: worstOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
            }))
        };
    }
    
    // For larger scenarios, use multiple strategic approaches
    const bearsGames = undecidedGames.filter(g => 
        g.homeTeam.abbr === TARGET_TEAM || g.awayTeam.abbr === TARGET_TEAM
    );
    
    // Get division rivals (other teams in same division)
    const targetTeam = nfcStandings.find(t => t.abbr === TARGET_TEAM);
    const targetDivision = targetTeam?.division || 'NFC North';
    const divisionRivals = nfcStandings
        .filter(t => t.division === targetDivision && t.abbr !== TARGET_TEAM)
        .map(t => t.abbr);
    
    const otherGames = undecidedGames.filter(g => 
        g.homeTeam.abbr !== TARGET_TEAM && g.awayTeam.abbr !== TARGET_TEAM
    );
    
    let worstResult = null;
    let worstOutcomes = null;
    
    // Strategy 1: Target team loses all, rivals win all, others random (3000 samples)
    for (let i = 0; i < 3000; i++) {
        const outcomes = { ...userOutcomes };
        
        bearsGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === TARGET_TEAM ? 'away' : 'home';
        });
        
        otherGames.forEach(game => {
            if (divisionRivals.includes(game.homeTeam.abbr)) {
                outcomes[game.id] = 'home';
            } else if (divisionRivals.includes(game.awayTeam.abbr)) {
                outcomes[game.id] = 'away';
            } else {
                outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
            }
        });
        
        const result = simulateScenario(outcomes);
        
        if (!worstResult || 
            (!result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs) ||
            (result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs && result.bearsSeed > worstResult.bearsSeed) ||
            (!result.bearsMadePlayoffs && !worstResult.bearsMadePlayoffs && 
             (result.bearsWildcardRank > worstResult.bearsWildcardRank || result.bearsDivisionRank > worstResult.bearsDivisionRank))) {
            worstResult = result;
            worstOutcomes = outcomes;
        }
    }
    
    // Strategy 2: All non-Bears games go chalk (favorites/better records win)
    for (let i = 0; i < 1000; i++) {
        const outcomes = { ...userOutcomes };
        
        bearsGames.forEach(game => {
            outcomes[game.id] = game.homeTeam.abbr === TARGET_TEAM ? 'away' : 'home';
        });
        
        otherGames.forEach(game => {
            outcomes[game.id] = Math.random() < 0.5 ? 'home' : 'away';
        });
        
        const result = simulateScenario(outcomes);
        
        if (!worstResult || 
            (!result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs) ||
            (result.bearsMadePlayoffs && worstResult.bearsMadePlayoffs && result.bearsSeed > worstResult.bearsSeed) ||
            (!result.bearsMadePlayoffs && !worstResult.bearsMadePlayoffs && 
             (result.bearsWildcardRank > worstResult.bearsWildcardRank || result.bearsDivisionRank > worstResult.bearsDivisionRank))) {
            worstResult = result;
            worstOutcomes = outcomes;
        }
    }
    
    return {
        outcomes: worstOutcomes,
        result: worstResult,
        gamesSet: criticalGames.filter(g => worstOutcomes[g.id]).map(g => ({
            ...g,
            selectedWinner: worstOutcomes[g.id] === 'home' ? g.homeTeam : g.awayTeam
        }))
    };
}

// ========================================
// UI RENDERING
// ========================================

function renderApp() {
    const targetTeam = nfcStandings.find(t => t.abbr === TARGET_TEAM);
    const teamName = targetTeam ? targetTeam.name : 'Team';
    
    // Update page title
    document.getElementById('pageTitle').textContent = `🏈 ${teamName} Playoff Calculator`;
    
    document.getElementById('app').innerHTML = `
        <div class="team-selector-container" style="text-align: center; margin-bottom: 20px;">
            <label for="teamSelector" style="font-size: 1.2em; margin-right: 10px;">Select Team:</label>
            <select id="teamSelector" style="font-size: 1.1em; padding: 8px 15px; border-radius: 6px; background: rgba(255,255,255,0.1); color: white; border: 2px solid rgba(255,255,255,0.3); cursor: pointer;">
                ${nfcStandings.map(team => `
                    <option value="${team.abbr}" ${team.abbr === TARGET_TEAM ? 'selected' : ''}>
                        ${team.name} (${team.wins}-${team.losses})
                    </option>
                `).join('')}
            </select>
        </div>
        
        <div class="playoff-chances" id="playoffChances">
            <div class="playoff-chances-left">
                <h2>${teamName} Playoff Chances</h2>
                <div class="playoff-percentage" id="playoffPercentage">---%</div>
                <div class="playoff-status" id="playoffStatus">Calculating scenarios...</div>
            </div>
            <div class="playoff-chances-right">
                <div class="scenario-item">
                    <h3>🎯 Best Case Scenario</h3>
                    <p id="bestCaseScenario">Loading...</p>
                </div>
                <div class="scenario-item">
                    <h3>⚠️ Worst Case Scenario</h3>
                    <p id="worstCaseScenario">Loading...</p>
                </div>
            </div>
        </div>
        
        <div class="main-grid">
            <div class="card">
                <h2>📊 NFC Standings</h2>
                <div id="standingsTable"></div>
            </div>
            
            <div class="card">
                <h2>🎯 Best Case Scenario</h2>
                <div id="bestCase"></div>
            </div>
        </div>
        
        <div class="card">
            <h2>🏈 Critical Games (${criticalGames.length})</h2>
            <p style="margin-bottom: 15px; color: #aaa; font-size: 0.95em;">
                Click outcomes to lock them in and see how it affects ${teamName} playoff chances
            </p>
            <div id="keyGames"></div>
        </div>
    `;
    
    renderStandings();
    renderKeyGames();
    
    // Add team selector change handler
    document.getElementById('teamSelector').addEventListener('change', (e) => {
        TARGET_TEAM = e.target.value;
        userOutcomes = {}; // Reset selected outcomes
        identifyCriticalGames(); // Recalculate critical games for new team
        renderApp(); // Re-render with new team
        calculateAndDisplayScenarios();
    });
}

function renderStandings() {
    const playoffTeams = calculatePlayoffTeams(nfcStandings);
    const playoffIds = playoffTeams.map(t => t.id);
    
    let html = '<table class="standings-table">';
    html += '<thead><tr>';
    html += '<th>Seed</th><th>Team</th><th>Record</th><th>Division</th>';
    html += '</tr></thead><tbody>';
    
    nfcStandings.forEach((team, index) => {
        const isPlayoffTeam = playoffIds.includes(team.id);
        const playoffTeam = playoffTeams.find(t => t.id === team.id);
        const isTarget = team.abbr === TARGET_TEAM;
        const isDivWinner = playoffTeam?.isDivisionWinner;
        
        let rowClass = '';
        if (isTarget) rowClass = 'highlight';
        else if (isDivWinner) rowClass = 'division-winner';
        else if (isPlayoffTeam) rowClass = 'playoff-team';
        
        html += `<tr class="${rowClass}">`;
        html += `<td>${isPlayoffTeam ? `<span class="playoff-seed">${playoffTeam.seed}</span>` : index + 1}</td>`;
        html += `<td>
            <div class="team-info">
                <img src="${team.logo}" alt="${team.abbr}" class="team-logo" onerror="this.style.display='none'">
                <span>${team.name}</span>
            </div>
        </td>`;
        html += `<td>${team.wins}-${team.losses}${team.ties > 0 ? '-' + team.ties : ''}</td>`;
        html += `<td>${team.division}</td>`;
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    document.getElementById('standingsTable').innerHTML = html;
}

function renderKeyGames() {
    let html = '';
    
    criticalGames.forEach(game => {
        const impactClass = game.impact.label.toLowerCase();
        const userOutcome = userOutcomes[game.id];
        
        html += `<div class="game-item ${game.impact.label === 'Critical' ? 'critical' : ''}">`;
        html += `<div class="game-header">`;
        html += `<span class="game-week">Week ${game.week}</span>`;
        html += `<span class="game-impact ${impactClass}">${game.impact.label}</span>`;
        html += `</div>`;
        
        html += `<div class="matchup">`;
        html += `<div class="team">
            <img src="${game.awayTeam.logo}" alt="${game.awayTeam.abbr}">
            <span>${game.awayTeam.name}</span>
            <span style="color: #888; font-size: 0.9em;">(${game.awayTeam.record})</span>
        </div>`;
        html += `<span class="vs">@</span>`;
        html += `<div class="team">
            <img src="${game.homeTeam.logo}" alt="${game.homeTeam.abbr}">
            <span>${game.homeTeam.name}</span>
            <span style="color: #888; font-size: 0.9em;">(${game.homeTeam.record})</span>
        </div>`;
        html += `</div>`;
        
        html += `<div class="outcome-selector">`;
        html += `<button class="outcome-btn ${userOutcome === 'away' ? 'selected' : ''}" 
                         onclick="setOutcome('${game.id}', 'away')">
                    ${game.awayTeam.abbr} wins
                 </button>`;
        html += `<button class="outcome-btn ${userOutcome === 'home' ? 'selected' : ''}" 
                         onclick="setOutcome('${game.id}', 'home')">
                    ${game.homeTeam.abbr} wins
                 </button>`;
        html += `<button class="outcome-btn reset ${!userOutcome ? 'selected' : ''}" 
                         onclick="setOutcome('${game.id}', null)">
                    ?
                 </button>`;
        html += `</div>`;
        
        html += `</div>`;
    });
    
    document.getElementById('keyGames').innerHTML = html;
}

function updatePlayoffChancesDisplay(probability, made, total, bestCase, worstCase) {
    document.getElementById('playoffPercentage').textContent = `${probability.toFixed(1)}%`;
    document.getElementById('playoffStatus').textContent = 
        `Made playoffs in ${made} of ${total} simulated scenarios`;
    
    // Update best case scenario
    const bestCaseEl = document.getElementById('bestCaseScenario');
    if (bestCase.result.bearsMadePlayoffs) {
        const bearsPlayoffTeam = bestCase.result.playoffTeams.find(t => t.abbr === TARGET_TEAM);
        
        if (bearsPlayoffTeam.isDivisionWinner) {
            const targetTeam = nfcStandings.find(t => t.abbr === TARGET_TEAM);
            const divisionName = targetTeam ? targetTeam.division : 'division';
            bestCaseEl.textContent = `Win ${divisionName} (#${bestCase.result.bearsSeed} seed)`;
        } else {
            // They're a wildcard - show which wildcard spot (1st, 2nd, or 3rd)
            const wildcards = bestCase.result.playoffTeams.filter(t => t.isWildCard);
            const wildcardPosition = wildcards.findIndex(t => t.abbr === TARGET_TEAM) + 1;
            const ordinal = (n) => ['1st', '2nd', '3rd'][n - 1] || n + 'th';
            bestCaseEl.textContent = `${ordinal(wildcardPosition)} wildcard (#${bestCase.result.bearsSeed} seed)`;
        }
    } else {
        // Show why they missed
        const divRank = bestCase.result.bearsDivisionRank;
        const wcRank = bestCase.result.bearsWildcardRank;
        const ordinal = (n) => {
            const s = ['th', 'st', 'nd', 'rd'];
            const v = n % 100;
            return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };
        bestCaseEl.textContent = `Miss playoffs (${ordinal(divRank)} in division, ${ordinal(wcRank)} in wildcard - need top 3)`;
    }
    
    // Update worst case scenario
    const worstCaseEl = document.getElementById('worstCaseScenario');
    if (worstCase.result.bearsMadePlayoffs) {
        const bearsPlayoffTeam = worstCase.result.playoffTeams.find(t => t.abbr === TARGET_TEAM);
        
        if (bearsPlayoffTeam.isDivisionWinner) {
            const targetTeam = nfcStandings.find(t => t.abbr === TARGET_TEAM);
            const divisionName = targetTeam ? targetTeam.division : 'division';
            worstCaseEl.textContent = `Win ${divisionName} (#${worstCase.result.bearsSeed} seed)`;
        } else {
            // They're a wildcard - show which wildcard spot (1st, 2nd, or 3rd)
            const wildcards = worstCase.result.playoffTeams.filter(t => t.isWildCard);
            const wildcardPosition = wildcards.findIndex(t => t.abbr === TARGET_TEAM) + 1;
            const ordinal = (n) => ['1st', '2nd', '3rd'][n - 1] || n + 'th';
            worstCaseEl.textContent = `${ordinal(wildcardPosition)} wildcard (#${worstCase.result.bearsSeed} seed)`;
        }
    } else {
        // Show why they missed
        const divRank = worstCase.result.bearsDivisionRank;
        const wcRank = worstCase.result.bearsWildcardRank;
        const ordinal = (n) => {
            const s = ['th', 'st', 'nd', 'rd'];
            const v = n % 100;
            return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };
        worstCaseEl.textContent = `Miss playoffs (${ordinal(divRank)} in division, ${ordinal(wcRank)} in wildcard - need top 3)`;
    }
}

function updateBestCaseDisplay(bestCase) {
    let html = '';
    
    if (bestCase.result.bearsMadePlayoffs) {
        html += `<p style="color: #4CAF50; font-size: 1.1em; margin-bottom: 15px;">
            ✅ <strong>Bears make playoffs as ${bestCase.result.bearsSeed} seed</strong>
        </p>`;
    } else {
        html += `<p style="color: #f44336; font-size: 1.1em; margin-bottom: 15px;">
            ❌ <strong>Bears miss playoffs even in best case</strong>
        </p>`;
    }
    
    html += '<p style="margin-bottom: 10px; font-size: 0.95em;">Key outcomes needed:</p>';
    html += '<ul class="scenario-list">';
    
    const bearsGames = bestCase.gamesSet.filter(g => 
        g.homeTeam.abbr === TARGET_TEAM || g.awayTeam.abbr === TARGET_TEAM
    ).slice(0, 5);
    
    bearsGames.forEach(game => {
        html += `<li>Week ${game.week}: ${game.selectedWinner.name} wins</li>`;
    });
    
    const otherGames = bestCase.gamesSet.filter(g => 
        g.homeTeam.abbr !== TARGET_TEAM && g.awayTeam.abbr !== TARGET_TEAM
    ).slice(0, 5);
    
    if (otherGames.length > 0) {
        html += '<li style="border-left-color: #888; margin-top: 10px; opacity: 0.7;">Plus favorable results:</li>';
        otherGames.forEach(game => {
            html += `<li class="negative" style="border-left-color: #888; opacity: 0.7;">
                Week ${game.week}: ${game.selectedWinner.name} wins
            </li>`;
        });
    }
    
    html += '</ul>';
    
    document.getElementById('bestCase').innerHTML = html;
}

// ========================================
// USER INTERACTION
// ========================================

function setOutcome(gameId, outcome) {
    if (outcome === null) {
        delete userOutcomes[gameId];
    } else {
        userOutcomes[gameId] = outcome;
    }
    
    // Re-render games
    renderKeyGames();
    
    // Recalculate scenarios
    calculateAndDisplayScenarios();
}

// Make function available globally
window.setOutcome = setOutcome;
