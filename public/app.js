// NFL Pick'em - Client Application
// Connects to local Express API server

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const API_BASE = ''; // Same origin, no prefix needed

let currentWeek = null;
let currentSeason = new Date().getFullYear();
let adminMode = false; // Allow picks for past games

// ========================================
// INITIALIZATION
// ========================================

window.addEventListener('DOMContentLoaded', async () => {
    await initSeasonSelector();
    await initWeekSelector();
    await loadSchedule();
});

async function initSeasonSelector() {
    const seasonSelect = document.getElementById('seasonSelect');
    if (!seasonSelect) return;
    
    const currentYear = new Date().getFullYear();
    
    try {
        // Fetch available seasons from the database
        const response = await fetch(`${API_BASE}/api/seasons`);
        const seasons = await response.json();
        
        // If we have seasons in the database, use those
        if (seasons && seasons.length > 0) {
            seasons.forEach(season => {
                const option = document.createElement('option');
                option.value = season;
                option.textContent = season;
                seasonSelect.appendChild(option);
            });
            
            // Set to current year if available, otherwise most recent season
            if (seasons.includes(currentYear)) {
                seasonSelect.value = currentYear;
                currentSeason = currentYear;
            } else {
                seasonSelect.value = seasons[0]; // Most recent (they're sorted DESC)
                currentSeason = seasons[0];
            }
        } else {
            // Fallback: if no data in DB yet, just show current year
            const option = document.createElement('option');
            option.value = currentYear;
            option.textContent = currentYear;
            seasonSelect.appendChild(option);
            seasonSelect.value = currentYear;
            currentSeason = currentYear;
        }
    } catch (error) {
        console.error('Error loading seasons:', error);
        // Fallback: show current year
        const option = document.createElement('option');
        option.value = currentYear;
        option.textContent = currentYear;
        seasonSelect.appendChild(option);
        seasonSelect.value = currentYear;
        currentSeason = currentYear;
    }
    
    // Resize the dropdown
    resizeSelect(seasonSelect);
}

async function initWeekSelector() {
    const select = document.getElementById('weekSelect');
    const selectTitle = document.getElementById('weekSelectTitle');
    
    // Get current week first
    const current = await getCurrentWeek();
    
    // Populate both dropdowns with the same options
    const populateSelect = (element) => {
        if (!element) return;
        
        element.innerHTML = '';
        
        // Regular season weeks
        for (let i = 1; i <= 18; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Week ${i}`;
            element.appendChild(option);
        }
        
        // Playoff weeks
        const playoffWeeks = [
            { value: 'wildcard', label: 'Wild Card' },
            { value: 'divisional', label: 'Divisional' },
            { value: 'conference', label: 'Conference Championships' },
            { value: 'superbowl', label: 'Super Bowl' }
        ];
        
        playoffWeeks.forEach((playoff, index) => {
            const option = document.createElement('option');
            option.value = playoff.value;
            option.textContent = playoff.label;
            element.appendChild(option);
        });
        
        // Set to current week
        element.value = current;
    };
    
    populateSelect(select);
    populateSelect(selectTitle);
    
    // Auto-resize dropdowns to fit content
    if (selectTitle) resizeSelect(selectTitle);
    if (select) resizeSelect(select);
}

function resizeSelect(selectElement) {
    if (!selectElement) return;
    
    // Create a temporary element to measure the text width
    const tempSpan = document.createElement('span');
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    tempSpan.style.fontSize = window.getComputedStyle(selectElement).fontSize;
    tempSpan.style.fontWeight = window.getComputedStyle(selectElement).fontWeight;
    tempSpan.style.fontFamily = window.getComputedStyle(selectElement).fontFamily;
    tempSpan.textContent = selectElement.options[selectElement.selectedIndex].text;
    
    document.body.appendChild(tempSpan);
    const width = tempSpan.offsetWidth;
    document.body.removeChild(tempSpan);
    
    // Add padding for the dropdown arrow and some breathing room
    const finalWidth = (width + 40) + 'px';
    selectElement.style.width = finalWidth;
}

async function changeWeek(direction) {
    // Use the title dropdown if it exists, otherwise fall back to old one
    const select = document.getElementById('weekSelectTitle') || document.getElementById('weekSelect');
    const currentValue = select.value;
    
    const allOptions = Array.from(select.options).map(opt => opt.value);
    let currentIndex = allOptions.indexOf(currentValue);
    
    // Calculate new index
    let newIndex = currentIndex + direction;
    
    // Clamp to valid range
    newIndex = Math.max(0, Math.min(allOptions.length - 1, newIndex));
    
    // Update both selects if they exist
    const newValue = allOptions[newIndex];
    const otherSelect = document.getElementById('weekSelect');
    if (select) {
        select.value = newValue;
        resizeSelect(select);
    }
    if (otherSelect) {
        otherSelect.value = newValue;
        resizeSelect(otherSelect);
    }
    
    loadSchedule();
}

function changeSeason() {
    const seasonSelect = document.getElementById('seasonSelect');
    if (seasonSelect) {
        currentSeason = parseInt(seasonSelect.value);
        resizeSelect(seasonSelect);
        loadSchedule();
    }
}

// Helper function to get season type and week number from selector value
function getSeasonTypeAndWeek(weekValue) {
    const playoffMap = {
        'wildcard': { week: 1, type: 3, label: 'Wild Card' },
        'divisional': { week: 2, type: 3, label: 'Divisional' },
        'conference': { week: 3, type: 3, label: 'Conference Championships' },
        'superbowl': { week: 4, type: 3, label: 'Super Bowl' }
    };
    
    if (playoffMap[weekValue]) {
        return playoffMap[weekValue];
    }
    
    // Regular season
    const weekNum = parseInt(weekValue);
    return { week: weekNum, type: 2, label: `Week ${weekNum}` };
}

// ========================================
// ESPN API FUNCTIONS
// ========================================

async function getCurrentWeek() {
    try {
        const response = await fetch(`${ESPN_API_BASE}/scoreboard`);
        const data = await response.json();
        if (data.week && data.week.number) {
            return data.week.number;
        }
        // Fallback calculation
        const now = new Date();
        const seasonStart = new Date(now.getFullYear(), 8, 1); // September 1st
        const weeksSinceStart = Math.floor((now - seasonStart) / (7 * 24 * 60 * 60 * 1000));
        return Math.max(1, Math.min(18, weeksSinceStart + 1));
    } catch (error) {
        console.error('Error getting current week:', error);
        return 12; // Default to week 12
    }
}

// ========================================
// GAME CACHING & MANAGEMENT
// ========================================

function shouldRefreshGames(cachedGames) {
    if (!cachedGames || cachedGames.length === 0) return true;
    
    // If any game isn't final, refresh
    if (cachedGames.some(g => g.status !== 'final')) return true;
    
    // On game days, refresh if cache is over 1 hour old
    const now = new Date();
    const isGameDay = now.getDay() === 0 || now.getDay() === 1 || now.getDay() === 4; // Sun, Mon, Thu
    
    if (isGameDay && cachedGames.length > 0) {
        const newestUpdate = new Date(Math.max(...cachedGames.map(g => new Date(g.last_updated))));
        const hoursSinceUpdate = (now - newestUpdate) / (1000 * 60 * 60);
        if (hoursSinceUpdate > 1) return true;
    }
    
    return false;
}

async function fetchAndCacheGames(week, season, seasonType = 2) {
    const response = await fetch(`${ESPN_API_BASE}/scoreboard?week=${week}&seasontype=${seasonType}`);
    const data = await response.json();
    
    if (!data.events || data.events.length === 0) {
        return null;
    }
    
    // Helper to get team logos - use nflfastr CDN for wordmarks
    const getTeamLogos = (team) => {
        let abbr = team.team.abbreviation.toUpperCase(); // Uppercase required for nflfastr URLs
        
        // Handle abbreviation mismatches between ESPN and nflfastr
        const abbrMap = {
            'WSH': 'WAS'  // Washington Commanders: ESPN uses WSH, nflfastr uses WAS
        };
        
        const wordmarkAbbr = abbrMap[abbr] || abbr;
        
        const logo = team.team.logo || '';
        // nflfastr hosts wordmarks on GitHub - use raw.githubusercontent.com for direct access
        const wordmark = `https://raw.githubusercontent.com/nflverse/nflverse-pbp/master/wordmarks/${wordmarkAbbr}.png`;
        return { logo, wordmark };
    };
    
    // Process and cache each game
    const games = [];
    for (const event of data.events) {
        const competition = event.competitions[0];
        const homeTeam = competition.competitors.find(t => t.homeAway === 'home');
        const awayTeam = competition.competitors.find(t => t.homeAway === 'away');
        
        const isCompleted = event.status.type.completed;
        const isInProgress = event.status.type.state === 'in';
        
        const awayLogos = getTeamLogos(awayTeam);
        const homeLogos = getTeamLogos(homeTeam);
        
        const gameData = {
            id: event.id,
            season: season,
            week: week,
            game_date: event.date,
            away_team: awayTeam.team.displayName,
            home_team: homeTeam.team.displayName,
            away_abbr: awayTeam.team.abbreviation,
            home_abbr: homeTeam.team.abbreviation,
            away_logo: awayLogos.logo,
            home_logo: homeLogos.logo,
            away_wordmark: awayLogos.wordmark,
            home_wordmark: homeLogos.wordmark,
            away_record: awayTeam.records?.[0]?.summary || '0-0',
            home_record: homeTeam.records?.[0]?.summary || '0-0',
            away_score: isCompleted || isInProgress ? parseInt(awayTeam.score) : null,
            home_score: isCompleted || isInProgress ? parseInt(homeTeam.score) : null,
            winner: isCompleted ? competition.competitors.find(t => t.winner)?.team.displayName : null,
            status: isCompleted ? 'final' : isInProgress ? 'in_progress' : 'scheduled',
            // Live status info (not saved to DB, just used for display)
            status_detail: event.status.type.detail || '',
            period: event.status.period || null,
            clock: event.status.displayClock || ''
        };
        
        // Save to database
        await fetch(`${API_BASE}/api/games`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(gameData)
        });
        
        games.push(gameData);
    }
    
    // Sort games by date/time, then alphabetically by home team
    games.sort((a, b) => {
        const dateCompare = new Date(a.game_date) - new Date(b.game_date);
        if (dateCompare !== 0) return dateCompare;
        return a.home_team.localeCompare(b.home_team);
    });
    
    // Return the games with full data
    return games;
}

async function loadGames(week, season, seasonType = 2) {
    // Try cache first
    const response = await fetch(`${API_BASE}/api/games/${season}/${week}`);
    const cachedGames = await response.json();
    
    // Check if we need to refresh
    if (shouldRefreshGames(cachedGames)) {
        return await fetchAndCacheGames(week, season, seasonType);
    }
    
    return cachedGames;
}

async function forceRefreshSchedule() {
    const weekSelect = document.getElementById('weekSelectTitle') || document.getElementById('weekSelect');
    const season = currentSeason;
    
    const weekInfo = getSeasonTypeAndWeek(weekSelect.value);
    const week = weekInfo.week;
    const seasonType = weekInfo.type;
    
    // Delete cached games
    const deleteResponse = await fetch(`${API_BASE}/api/games/${season}/${week}`, {
        method: 'DELETE'
    });
    
    // Force fetch from ESPN (bypassing cache)
    const games = await fetchAndCacheGames(week, season, seasonType);
    
    // Reload schedule (will now use fresh data from DB)
    await loadSchedule();
}

async function scoreCompletedGames(games) {
    for (const game of games) {
        if (game.status === 'final' && game.winner) {
            // Score picks for this game
            await fetch(`${API_BASE}/api/score-picks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    game_id: game.id,
                    winner: game.winner
                })
            });
        }
    }
}

// ========================================
// PLAYER MANAGEMENT
// ========================================

async function loadWeekPlayers(season, week) {
    const response = await fetch(`${API_BASE}/api/week-players/${season}/${week}`);
    let players = await response.json();
    
    // If no players for this week, copy from previous week
    if (!players || players.length === 0) {
        const prevWeek = week - 1;
        if (prevWeek > 0) {
            const prevResponse = await fetch(`${API_BASE}/api/week-players/${season}/${prevWeek}`);
            const prevPlayers = await prevResponse.json();
            
            if (prevPlayers && prevPlayers.length > 0) {
                // Copy to current week
                for (const player of prevPlayers) {
                    await fetch(`${API_BASE}/api/week-players`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            season: season,
                            week: week,
                            player_name: player.player_name,
                            display_order: player.display_order
                        })
                    });
                }
                players = prevPlayers;
            }
        }
    }
    
    return players || [];
}

async function removePlayerFromWeek(playerName) {
    if (!confirm(`Remove ${playerName} from this week?`)) return;
    
    const weekSelect = document.getElementById('weekSelectTitle') || document.getElementById('weekSelect');
    const season = currentSeason;
    
    const weekInfo = getSeasonTypeAndWeek(weekSelect.value);
    const week = weekInfo.week;
    
    await fetch(`${API_BASE}/api/week-players/${season}/${week}/${encodeURIComponent(playerName)}`, {
        method: 'DELETE'
    });
    
    await loadSchedule();
}

async function loadPastPlayers() {
    const response = await fetch(`${API_BASE}/api/players`);
    const players = await response.json();
    return players;
}

// Modal functions for adding players
async function showAddPlayerMenu() {
    const weekSelect = document.getElementById('weekSelectTitle') || document.getElementById('weekSelect');
    const season = currentSeason;
    
    const weekInfo = getSeasonTypeAndWeek(weekSelect.value);
    const week = weekInfo.week;
    
    // Get current players for this week
    const currentResponse = await fetch(`${API_BASE}/api/week-players/${season}/${week}`);
    const currentPlayers = await currentResponse.json();
    const currentPlayerNames = currentPlayers.map(p => p.player_name);
    
    // Get all past players
    const allPlayers = await loadPastPlayers();
    const availablePlayers = allPlayers.filter(p => !currentPlayerNames.includes(p.name));
    
    // Populate player list
    const playerList = document.getElementById('playerList');
    if (availablePlayers.length === 0) {
        playerList.innerHTML = '<div style="color: #999; font-style: italic;">No existing players available</div>';
    } else {
        playerList.innerHTML = availablePlayers.map(player => 
            `<div class="player-option" onclick="addExistingPlayer('${player.name}')">${player.name}</div>`
        ).join('');
    }
    
    // Show modal
    document.getElementById('addPlayerModal').classList.add('show');
}

function closeAddPlayerMenu(event) {
    if (event && event.target.className !== 'modal') return;
    document.getElementById('addPlayerModal').classList.remove('show');
    document.getElementById('newPlayerInput').style.display = 'none';
    document.getElementById('newPlayerName').value = '';
}

function showNewPlayerInput() {
    document.getElementById('newPlayerInput').style.display = 'block';
    document.getElementById('newPlayerName').focus();
}

function cancelNewPlayer() {
    document.getElementById('newPlayerInput').style.display = 'none';
    document.getElementById('newPlayerName').value = '';
}

async function addExistingPlayer(playerName) {
    await addPlayerByName(playerName);
    closeAddPlayerMenu();
}

async function addNewPlayer() {
    const playerName = document.getElementById('newPlayerName').value.trim();
    if (!playerName) {
        alert('Please enter a player name');
        return;
    }
    
    await addPlayerByName(playerName);
    closeAddPlayerMenu();
}

async function addPlayerByName(playerName) {
    const weekSelect = document.getElementById('weekSelectTitle') || document.getElementById('weekSelect');
    const season = currentSeason;
    
    const weekInfo = getSeasonTypeAndWeek(weekSelect.value);
    const week = weekInfo.week;
    
    // Get current players to determine next display order
    const existingResponse = await fetch(`${API_BASE}/api/week-players/${season}/${week}`);
    const existing = await existingResponse.json();
    
    // Check if player already exists for this week
    if (existing.some(p => p.player_name === playerName)) {
        alert('Player already added to this week');
        return;
    }
    
    const nextOrder = existing.length > 0 
        ? Math.max(...existing.map(p => p.display_order)) + 1 
        : 1;
    
    // Add player
    await fetch(`${API_BASE}/api/week-players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            season: season,
            week: week,
            player_name: playerName,
            display_order: nextOrder
        })
    });
    
    await loadSchedule();
}

function renderActivePlayersUI(weekPlayers) {
    const container = document.getElementById('activePlayers');
    container.innerHTML = '';
    
    if (weekPlayers.length === 0) {
        container.innerHTML = '<p class="no-players">No players yet. Click + to add!</p>';
    } else {
        weekPlayers.forEach(player => {
            const chip = document.createElement('div');
            chip.className = 'player-chip';
            chip.innerHTML = `
                ${player.player_name}
                <button onclick="removePlayerFromWeek('${player.player_name.replace(/'/g, "\\'")}')">✕</button>
            `;
            container.appendChild(chip);
        });
    }
    
    // Add the + button as a div to match player chips
    const addBtn = document.createElement('div');
    addBtn.className = 'add-player-btn';
    addBtn.title = 'Add Player';
    addBtn.textContent = '+';
    addBtn.onclick = showAddPlayerMenu;
    container.appendChild(addBtn);
}

// ========================================
// PICKS MANAGEMENT
// ========================================

async function loadPicksForWeek(week, season) {
    const response = await fetch(`${API_BASE}/api/picks/${season}/${week}`);
    const picks = await response.json();
    
    // Organize picks by player and game
    const organized = {};
    picks.forEach(pick => {
        if (!organized[pick.player_name]) {
            organized[pick.player_name] = {};
        }
        organized[pick.player_name][pick.game_id] = pick;
    });
    
    return organized;
}

async function togglePick(gameId, gameDate, awayTeam, homeTeam, pickedTeam, playerName) {
    // Check if game has started (unless in admin mode)
    const gameStarted = new Date() >= new Date(gameDate);
    if (gameStarted && !adminMode) {
        const confirmed = confirm('This game has already started. Do you want to change picks for completed games?');
        if (confirmed) {
            adminMode = true; // Enable admin mode for this session
            showAdminIndicator();
        } else {
            return;
        }
    }
    
    const weekSelect = document.getElementById('weekSelectTitle') || document.getElementById('weekSelect');
    const season = currentSeason;
    
    const weekInfo = getSeasonTypeAndWeek(weekSelect.value);
    const week = weekInfo.week;
    
    // Check if this team is already picked (deselect if so)
    const clickedDiv = event.target.closest('.team-pick-logo');
    const isAlreadySelected = clickedDiv && clickedDiv.classList.contains('selected');
    
    if (isAlreadySelected) {
        // Deselect - delete the pick from database
        await fetch(`${API_BASE}/api/picks/${playerName}/${gameId}`, {
            method: 'DELETE'
        });
        
        // Remove selected class from UI
        const allPickDivsForGame = document.querySelectorAll(`[data-game="${gameId}"][data-player="${playerName}"]`);
        allPickDivsForGame.forEach(div => {
            div.classList.remove('selected', 'correct', 'incorrect');
        });
        
        return;
    }
    
    // Save pick
    const response = await fetch(`${API_BASE}/api/picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            player_name: playerName,
            game_id: gameId,
            season: season,
            week: week,
            picked_team: pickedTeam
        })
    });
    
    if (!response.ok) {
        alert('Error saving pick');
        return;
    }
    
    // Update UI without full reload - update the logo divs for this player/game
    const allPickDivsForGame = document.querySelectorAll(`[data-game="${gameId}"][data-player="${playerName}"]`);
    allPickDivsForGame.forEach(div => {
        // Remove all state classes
        div.classList.remove('selected', 'correct', 'incorrect');
        
        // Add selected class to the picked team
        if (div.dataset.team === pickedTeam) {
            div.classList.add('selected');
        }
    });
}

function showAdminIndicator() {
    const indicator = document.getElementById('adminModeIndicator');
    indicator.style.display = 'inline-block';
}

async function exitAdminMode() {
    adminMode = false;
    const indicator = document.getElementById('adminModeIndicator');
    indicator.style.display = 'none';
    // Reload schedule to score picks and update colors
    await loadSchedule();
}

// ========================================
// SCHEDULE RENDERING
// ========================================

async function loadSchedule() {
    const weekSelect = document.getElementById('weekSelectTitle') || document.getElementById('weekSelect');
    const content = document.getElementById('content');
    const season = currentSeason;
    
    // Reset admin mode when changing weeks
    adminMode = false;
    
    content.innerHTML = '<div class="loading">Loading schedule...</div>';
    
    try {
        // Get week number and season type
        let week, seasonType, weekLabel;
        
        const weekInfo = getSeasonTypeAndWeek(weekSelect.value);
        week = weekInfo.week;
        seasonType = weekInfo.type;
        weekLabel = weekInfo.label;
        currentWeek = week;
        
        // Sync both dropdowns
        const otherSelect = document.getElementById('weekSelect');
        if (weekSelect) {
            weekSelect.value = weekSelect.value;
            resizeSelect(weekSelect);
        }
        if (otherSelect) {
            otherSelect.value = weekSelect.value;
            resizeSelect(otherSelect);
        }
        
        // Load games (from cache or ESPN)
        const games = await loadGames(week, season, seasonType);
        
        if (!games || games.length === 0) {
            content.innerHTML = `<div class="error">No games found for ${weekLabel}.<br>Try selecting a different week.</div>`;
            return;
        }
        
        // Score any completed games
        await scoreCompletedGames(games);
        
        // Load week players
        const weekPlayers = await loadWeekPlayers(season, week);
        
        // Load past players for autocomplete
        await loadPastPlayers();
        
        // Update UI - dropdowns handle the title display
        renderActivePlayersUI(weekPlayers);
        
        // Render schedule
        await renderScheduleTable(games, weekPlayers, season, week);
        
    } catch (error) {
        content.innerHTML = `<div class="error">Error loading schedule: ${error.message}<br>Check console (F12) for details.</div>`;
        console.error('Error:', error);
    }
}

async function renderScheduleTable(games, weekPlayers, season, week) {
    const allPicks = await loadPicksForWeek(week, season);
    const playerNames = weekPlayers.map(p => p.player_name);
    
    let html = '<table><thead><tr>';
    html += '<th class="team-column">Game</th>';
    
    playerNames.forEach(name => {
        html += `<th class="pick-column"><div class="member-name">${name}</div></th>`;
    });
    
    html += '</tr></thead><tbody>';
    
    games.forEach(game => {
        const gameDate = new Date(game.game_date);
        let dateStr = gameDate.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        // Add FINAL to date string if game is complete
        if (game.status === 'final') {
            dateStr += ' - FINAL';
        } else if (game.status === 'in_progress') {
            if (game.period && game.clock) {
                const quarterMap = { 1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4', 5: 'OT' };
                const quarter = quarterMap[game.period] || `Q${game.period}`;
                dateStr += ` - ${quarter} ${game.clock}`;
            } else if (game.status_detail) {
                dateStr += ` - ${game.status_detail}`;
            } else {
                dateStr += ' - IN PROGRESS';
            }
        }
        
        // Add status-based class for background color
        let statusClass = '';
        if (game.status === 'final') {
            statusClass = 'game-final';
        } else if (game.status === 'in_progress') {
            statusClass = 'game-in-progress';
        }
        
        html += '<tr>';
        html += `<td class="team-column game-history-cell ${statusClass}" style="cursor:pointer;" onclick="showGameHistoryModal('${game.away_team.replace(/'/g, "\\'")}', '${game.home_team.replace(/'/g, "\\'")}', ${season})">
            <div class="game-info">${dateStr}</div>
            <div class="matchup">
                <div class="team-info">
                    ${game.away_logo ? `<img src="${game.away_logo}" alt="${game.away_abbr || game.away_team}" class="team-logo" onerror="this.style.display='none'">` : ''}
                    <div class="team-details">
                        <span class="team-name ${game.winner === game.away_team ? 'winner' : ''}">${game.away_abbr || game.away_team}</span>
                        ${game.status === 'final' || game.status === 'in_progress' ? `<span class="team-record">(${game.away_score})</span>` : game.away_record ? `<span class="team-record">${game.away_record}</span>` : ''}
                    </div>
                </div>
                <span class="vs">@</span>
                <div class="team-info">
                    ${game.home_logo ? `<img src="${game.home_logo}" alt="${game.home_abbr || game.home_team}" class="team-logo" onerror="this.style.display='none'">` : ''}
                    <div class="team-details">
                        <span class="team-name ${game.winner === game.home_team ? 'winner' : ''}">${game.home_abbr || game.home_team}</span>
                        ${game.status === 'final' || game.status === 'in_progress' ? `<span class="team-record">(${game.home_score})</span>` : game.home_record ? `<span class="team-record">${game.home_record}</span>` : ''}
                    </div>
                </div>
            </div>
        </td>`;
        
        // Add pick columns for each player
        playerNames.forEach(playerName => {
            const playerPicks = allPicks[playerName] || {};
            const pick = playerPicks[game.id];
            const currentPick = pick?.picked_team;
            
            // Determine pick status styling
            let awayClass = currentPick === game.away_team ? 'selected' : '';
            let homeClass = currentPick === game.home_team ? 'selected' : '';
            
            if (game.status === 'final' && pick) {
                if (pick.is_correct === 1) {
                    awayClass += currentPick === game.away_team ? ' correct' : '';
                    homeClass += currentPick === game.home_team ? ' correct' : '';
                } else if (pick.is_correct === 0) {
                    awayClass += currentPick === game.away_team ? ' incorrect' : '';
                    homeClass += currentPick === game.home_team ? ' incorrect' : '';
                }
            }
            
            const awayAbbr = game.away_team.split(' ').pop(); // Last word (team name)
            const homeAbbr = game.home_team.split(' ').pop();
            
            html += `<td class="pick-cell">
                <div class="pick-options-logos">
                    <div 
                        class="team-pick-logo ${currentPick === game.away_team ? 'selected' : ''} ${
                            game.status === 'final' && pick ? 
                                (pick.is_correct === 1 && currentPick === game.away_team ? 'correct' : 
                                 pick.is_correct === 0 && currentPick === game.away_team ? 'incorrect' : '') 
                            : ''
                        }"
                        onclick="togglePick('${game.id}', '${game.game_date}', '${game.away_team}', '${game.home_team}', '${game.away_team}', '${playerName.replace(/'/g, "\\'")}')"
                        title="${game.away_team}"
                        data-game="${game.id}"
                        data-player="${playerName}"
                        data-team="${game.away_team}"
                    >
                        ${game.away_logo ? `<img src="${game.away_logo}" alt="${game.away_abbr || awayAbbr}" class="pick-logo" onerror="this.style.display='none'">` : `<span class="pick-abbr">${game.away_abbr || awayAbbr}</span>`}
                    </div>
                    <div 
                        class="team-pick-logo ${currentPick === game.home_team ? 'selected' : ''} ${
                            game.status === 'final' && pick ? 
                                (pick.is_correct === 1 && currentPick === game.home_team ? 'correct' : 
                                 pick.is_correct === 0 && currentPick === game.home_team ? 'incorrect' : '') 
                            : ''
                        }"
                        onclick="togglePick('${game.id}', '${game.game_date}', '${game.away_team}', '${game.home_team}', '${game.home_team}', '${playerName.replace(/'/g, "\\'")}')"
                        title="${game.home_team}"
                        data-game="${game.id}"
                        data-player="${playerName}"
                        data-team="${game.home_team}"
                    >
                        ${game.home_logo ? `<img src="${game.home_logo}" alt="${game.home_abbr || homeAbbr}" class="pick-logo" onerror="this.style.display='none'">` : `<span class="pick-abbr">${game.home_abbr || homeAbbr}</span>`}
                    </div>
                </div>
            </td>`;
        });
        
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    document.getElementById('content').innerHTML = html;
}

// ========================================
// GAME HISTORY MODAL
// ========================================

async function showGameHistoryModal(awayTeam, homeTeam, season) {
    const modal = document.getElementById('gameHistoryModal');
    const title = document.getElementById('gameHistoryTitle');
    const body = document.getElementById('gameHistoryBody');
    
    title.textContent = `${awayTeam} vs ${homeTeam} - Game Histories`;
    body.innerHTML = '<div class="loading">Loading game histories...</div>';
    
    // Show modal
    modal.classList.add('show');
    
    try {
        // Fetch both teams' game histories in parallel
        const [awayResponse, homeResponse] = await Promise.all([
            fetch(`/api/games/${season}/team/${encodeURIComponent(awayTeam)}`),
            fetch(`/api/games/${season}/team/${encodeURIComponent(homeTeam)}`)
        ]);
        
        const [awayGames, homeGames] = await Promise.all([
            awayResponse.json(),
            homeResponse.json()
        ]);
        
        // Helper to fix wordmark URLs for teams with abbreviation mismatches
        const fixWordmarkUrl = (url) => {
            if (!url) return url;
            // Replace WSH with WAS in the URL
            return url.replace('/WSH.png', '/WAS.png');
        };
        
        // Get team logos and abbreviations from first game
        const awayLogo = awayGames.length > 0 ? (awayGames[0].away_team === awayTeam ? awayGames[0].away_logo : awayGames[0].home_logo) : '';
        const homeLogo = homeGames.length > 0 ? (homeGames[0].away_team === homeTeam ? homeGames[0].away_logo : homeGames[0].home_logo) : '';
        let awayWordmark = awayGames.length > 0 ? (awayGames[0].away_team === awayTeam ? awayGames[0].away_wordmark : awayGames[0].home_wordmark) : '';
        let homeWordmark = homeGames.length > 0 ? (homeGames[0].away_team === homeTeam ? homeGames[0].away_wordmark : homeGames[0].home_wordmark) : '';
        
        // Fix wordmark URLs for abbreviation mismatches
        awayWordmark = fixWordmarkUrl(awayWordmark);
        homeWordmark = fixWordmarkUrl(homeWordmark);
        
        const awayAbbr = awayGames.length > 0 ? (awayGames[0].away_team === awayTeam ? awayGames[0].away_abbr : awayGames[0].home_abbr) : awayTeam;
        const homeAbbr = homeGames.length > 0 ? (homeGames[0].away_team === homeTeam ? homeGames[0].away_abbr : homeGames[0].home_abbr) : homeTeam;
        
        // Build table with weeks as rows, teams as columns
        let tableHtml = '<table class="game-history-table"><thead><tr>';
        tableHtml += '<th>Week</th>';
        tableHtml += `<th><img src="${awayWordmark || awayLogo}" alt="${awayAbbr}" class="team-wordmark" onerror="this.src='${awayLogo}'; this.className='team-logo';"> </th>`;
        tableHtml += `<th><img src="${homeWordmark || homeLogo}" alt="${homeAbbr}" class="team-wordmark" onerror="this.src='${homeLogo}'; this.className='team-logo';"> </th>`;
        tableHtml += '</tr></thead><tbody>';
        
        // Get all unique weeks from both teams
        const allWeeks = new Set([...awayGames.map(g => g.week), ...homeGames.map(g => g.week)]);
        const sortedWeeks = Array.from(allWeeks).sort((a, b) => a - b);
        
        sortedWeeks.forEach(week => {
            const awayGame = awayGames.find(g => g.week === week);
            const homeGame = homeGames.find(g => g.week === week);
            
            tableHtml += `<tr><td><strong>Week ${week}</strong></td>`;
            
            // Away team cell
            if (awayGame && awayGame.status === 'final') {
                const isHome = awayGame.home_team === awayTeam;
                const opponent = isHome ? awayGame.away_team : awayGame.home_team;
                const oppAbbr = isHome ? awayGame.away_abbr : awayGame.home_abbr;
                const oppLogo = isHome ? awayGame.away_logo : awayGame.home_logo;
                const vsAt = isHome ? 'vs' : '@';
                const teamScore = isHome ? awayGame.home_score : awayGame.away_score;
                const oppScore = isHome ? awayGame.away_score : awayGame.home_score;
                const won = teamScore > oppScore;
                const resultClass = won ? 'win' : 'loss';
                const resultText = won ? 'W' : 'L';
                
                tableHtml += `<td>
                    <div>${vsAt} <img src="${oppLogo}" alt="${oppAbbr}" class="team-logo" onerror="this.style.display='none'" style="vertical-align:middle;"> ${oppAbbr}</div>
                    <div>${teamScore}-${oppScore} <span class="${resultClass}">${resultText}</span></div>
                </td>`;
            } else {
                tableHtml += '<td><em>—</em></td>';
            }
            
            // Home team cell
            if (homeGame && homeGame.status === 'final') {
                const isHome = homeGame.home_team === homeTeam;
                const opponent = isHome ? homeGame.away_team : homeGame.home_team;
                const oppAbbr = isHome ? homeGame.away_abbr : homeGame.home_abbr;
                const oppLogo = isHome ? homeGame.away_logo : homeGame.home_logo;
                const vsAt = isHome ? 'vs' : '@';
                const teamScore = isHome ? homeGame.home_score : homeGame.away_score;
                const oppScore = isHome ? homeGame.away_score : homeGame.home_score;
                const won = teamScore > oppScore;
                const resultClass = won ? 'win' : 'loss';
                const resultText = won ? 'W' : 'L';
                
                tableHtml += `<td>
                    <div>${vsAt} <img src="${oppLogo}" alt="${oppAbbr}" class="team-logo" onerror="this.style.display='none'" style="vertical-align:middle;"> ${oppAbbr}</div>
                    <div>${teamScore}-${oppScore} <span class="${resultClass}">${resultText}</span></div>
                </td>`;
            } else {
                tableHtml += '<td><em>—</em></td>';
            }
            
            tableHtml += '</tr>';
        });
        
        tableHtml += '</tbody></table>';
        body.innerHTML = tableHtml;
        
    } catch (error) {
        body.innerHTML = `<div class="error">Error loading game histories: ${error.message}</div>`;
    }
}

function closeGameHistoryModal(event) {
    if (event && event.target.className !== 'modal') return;
    const modal = document.getElementById('gameHistoryModal');
    modal.classList.remove('show');
}

// ========================================
// LEADERBOARD
// ========================================

async function showLeaderboard(viewType = 'season') {
    const season = currentSeason;
    const week = currentWeek || await getCurrentWeek();
    
    let standings;
    
    if (viewType === 'week') {
        const response = await fetch(`${API_BASE}/api/leaderboard/${season}/${week}`);
        standings = await response.json();
    } else {
        const response = await fetch(`${API_BASE}/api/leaderboard/${season}`);
        standings = await response.json();
    }
    
    // Render
    const title = viewType === 'week' ? `Week ${week} Results` : `${season} Season Standings`;
    
    let html = `
        <div class="leaderboard">
            <h2>🏆 ${title}</h2>
            
            <div class="leaderboard-controls">
                <button onclick="showLeaderboard('season')" class="${viewType === 'season' ? 'active' : ''}">
                    Season
                </button>
                <button onclick="showLeaderboard('week')" class="${viewType === 'week' ? 'active' : ''}">
                    Week ${week}
                </button>
            </div>
            
            <table class="leaderboard-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Player</th>
                        <th>Wins</th>
                        <th>Losses</th>
                        <th>Win %</th>
                        ${viewType === 'season' ? '<th>Weeks</th>' : ''}
                    </tr>
                </thead>
                <tbody>
    `;
    
    if (standings.length === 0) {
        html += `<tr><td colspan="${viewType === 'season' ? '6' : '5'}" style="text-align: center; padding: 20px;">No scored picks yet!</td></tr>`;
    } else {
        // Calculate ranks with tie handling
        let currentRank = 1;
        let previousWins = null;
        let previousLosses = null;
        
        standings.forEach((record, index) => {
            const total = record.wins + record.losses;
            const pct = total > 0 ? (record.wins / total * 100).toFixed(1) : '0.0';
            
            // Check if this record is tied with the previous one
            if (index > 0 && record.wins === previousWins && record.losses === previousLosses) {
                // Same rank as previous (tie)
            } else {
                // New rank
                currentRank = index + 1;
            }
            
            previousWins = record.wins;
            previousLosses = record.losses;
            
            const rank = currentRank;
            const isLastPlace = (index === standings.length - 1) && (rank !== 1); // Last and not tied for first
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : isLastPlace ? '😢' : rank;
            
            html += `
                <tr class="rank-${rank}">
                    <td>${medal}</td>
                    <td class="player-name">${record.player_name}</td>
                    <td>${record.wins}</td>
                    <td>${record.losses}</td>
                    <td><strong>${pct}%</strong></td>
                    ${viewType === 'season' ? `<td>${record.weeks_played || 0}</td>` : ''}
                </tr>
            `;
        });
    }
    
    html += `
                </tbody>
            </table>
            
            <button onclick="loadSchedule()" class="back-button">← Back to Picks</button>
        </div>
    `;
    
    document.getElementById('content').innerHTML = html;
}
