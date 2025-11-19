// NFL Pick'em - Main JavaScript
// Using ESPN's free API - no API key needed!

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

// Initialize week selector
function initWeekSelector() {
    const select = document.getElementById('weekSelect');
    select.innerHTML = '<option value="current">Current Week</option>';
    for (let i = 1; i <= 18; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Week ${i}`;
        select.appendChild(option);
    }
}

// Load member names from localStorage
function loadMemberNames() {
    for (let i = 1; i <= 4; i++) {
        const saved = localStorage.getItem(`member${i}`);
        if (saved) {
            document.getElementById(`member${i}`).value = saved;
        }
    }
}

// Save member names to localStorage
function saveMemberNames() {
    for (let i = 1; i <= 4; i++) {
        const value = document.getElementById(`member${i}`).value;
        localStorage.setItem(`member${i}`, value);
    }
}

// Get current NFL week from ESPN
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
        return 12; // Default to week 12 in November
    }
}

// Get team standings from ESPN
async function getTeamRecords() {
    try {
        const response = await fetch(`${ESPN_API_BASE}/standings`);
        const data = await response.json();
        const records = {};
        
        if (data.children) {
            data.children.forEach(conference => {
                if (conference.standings && conference.standings.entries) {
                    conference.standings.entries.forEach(team => {
                        if (team.team) {
                            const teamId = team.team.id;
                            const stats = team.stats;
                            const wins = stats.find(s => s.name === 'wins')?.value || 0;
                            const losses = stats.find(s => s.name === 'losses')?.value || 0;
                            records[teamId] = `${wins}-${losses}`;
                        }
                    });
                }
            });
        }
        
        return records;
    } catch (error) {
        console.error('Error fetching team records:', error);
        return {};
    }
}

// Load schedule for a specific week
async function loadSchedule() {
    saveMemberNames();
    
    const weekSelect = document.getElementById('weekSelect').value;
    const content = document.getElementById('content');
    
    content.innerHTML = '<div class="loading">Loading schedule...</div>';
    
    try {
        let week;
        if (weekSelect === 'current') {
            week = await getCurrentWeek();
        } else {
            week = parseInt(weekSelect);
        }
        
        console.log('Loading schedule for week:', week);
        
        // Fetch games for the specific week
        const response = await fetch(`${ESPN_API_BASE}/scoreboard?week=${week}&seasontype=2`);
        const data = await response.json();
        
        console.log('ESPN data received:', data);
        
        if (!data.events || data.events.length === 0) {
            content.innerHTML = `<div class="error">No games found for week ${week}.<br>Try selecting a different week.</div>`;
            return;
        }
        
        // Get team records
        const teamRecords = await getTeamRecords();
        
        const currentYear = new Date().getFullYear();
        const season = data.season?.year || currentYear;
        
        document.getElementById('weekTitle').textContent = `Week ${week} - ${season} Season`;
        
        renderScheduleTable(data.events, teamRecords);
        
    } catch (error) {
        content.innerHTML = `<div class="error">Error loading schedule: ${error.message}<br>Check console (F12) for details.</div>`;
        console.error('Error:', error);
    }
}

// Render the schedule table
function renderScheduleTable(events, teamRecords) {
    const memberNames = [
        document.getElementById('member1').value || 'Player 1',
        document.getElementById('member2').value || 'Player 2',
        document.getElementById('member3').value || 'Player 3',
        document.getElementById('member4').value || 'Player 4'
    ];
    
    let html = '<table><thead><tr>';
    html += '<th class="team-column">Game</th>';
    
    memberNames.forEach(name => {
        html += `<th class="pick-column"><div class="member-name">${name}</div></th>`;
    });
    
    html += '</tr></thead><tbody>';
    
    events.forEach(event => {
        const competition = event.competitions[0];
        const homeTeam = competition.competitors.find(t => t.homeAway === 'home');
        const awayTeam = competition.competitors.find(t => t.homeAway === 'away');
        
        const gameDate = new Date(event.date);
        const dateStr = gameDate.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        
        // Get records from the competition data (more reliable than standings)
        const awayRecord = awayTeam.records?.[0]?.summary || teamRecords[awayTeam.team.id] || '0-0';
        const homeRecord = homeTeam.records?.[0]?.summary || teamRecords[homeTeam.team.id] || '0-0';
        
        // Get team logos (ESPN provides them in the team object)
        const awayLogo = awayTeam.team.logo || '';
        const homeLogo = homeTeam.team.logo || '';
        
        html += '<tr>';
        html += `<td class="team-column">
            <div class="game-info">${dateStr}</div>
            <div class="matchup">
                <img src="${awayLogo}" alt="${awayTeam.team.abbreviation}" class="team-logo" onerror="this.style.display='none'">
                <span class="team-name">${awayTeam.team.displayName}</span>
                <span class="team-record">(${awayRecord})</span>
                <span class="vs">@</span>
                <img src="${homeLogo}" alt="${homeTeam.team.abbreviation}" class="team-logo" onerror="this.style.display='none'">
                <span class="team-name">${homeTeam.team.displayName}</span>
                <span class="team-record">(${homeRecord})</span>
            </div>
        </td>`;
        
        // Add 4 empty pick columns
        for (let i = 0; i < 4; i++) {
            html += '<td class="pick-cell"></td>';
        }
        
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    document.getElementById('content').innerHTML = html;
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
    initWeekSelector();
    loadMemberNames();
    
    // Auto-load current week
    loadSchedule();
});

// Save member names when they change
for (let i = 1; i <= 4; i++) {
    document.getElementById(`member${i}`).addEventListener('change', saveMemberNames);
}
