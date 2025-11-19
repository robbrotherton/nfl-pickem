# NFL Pick'em Website

A full-stack web application for managing NFL pick'em pools with live scores, automatic scoring, and leaderboards.

## Project Structure

```
nfl-pickem/
├── server.js           # Express.js backend with SQLite database
├── package.json        # Node.js dependencies
├── nfl-pickem.db      # SQLite database (auto-created)
└── public/
    ├── index.html     # Main HTML page
    ├── styles.css     # All styling and responsive design
    └── app.js         # Frontend JavaScript application
```

## Features

- 📅 **Live NFL Schedules**: Fetches schedules from ESPN's free public API
- 🏆 **Automatic Scoring**: Games are automatically scored when completed
- 👥 **Multi-Player Support**: Add any number of players per week
- 📊 **Leaderboards**: Season-long and weekly leaderboards
- � **Live Score Updates**: Shows current scores for in-progress games
- 🏈 **Playoff Support**: Handles Wild Card, Divisional, Conference, and Super Bowl weeks
- 🖨️ **Print-Friendly**: Clean printout for traditional paper pick'em
- 💾 **Database Storage**: All picks and games cached in SQLite
- � **Responsive Design**: Works on desktop and mobile devices
- 🔓 **Admin Mode**: Edit picks for past games when needed
- 🆓 **Completely Free**: Uses ESPN's public API, no API key required

## Prerequisites

- **Node.js**: v20 LTS or higher (v20.x recommended for better-sqlite3 compatibility)
- **Ubuntu Server**: 20.04 or newer (or any Linux distribution)
- **Network Access**: Local network access for ESPN API

## Setup on Ubuntu Server

### 1. Install Git and Node.js

```bash
# Update package list
sudo apt update

# Install Git
sudo apt install -y git

# Install Node.js v20 (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installations
git --version
node --version  # Should show v20.x.x
npm --version
```

### 2. Clone the Repository

```bash
# Clone from GitHub
cd ~
git clone https://github.com/robbrotherton/nfl-pickem.git
cd nfl-pickem
```

### 3. Install Dependencies

```bash
npm install

# Install PM2 globally for process management
sudo npm install -g pm2
```

This will install:
- `express` - Web server framework
- `better-sqlite3` - SQLite database driver
- `cors` - Cross-origin resource sharing
- `pm2` - Process manager to keep the server running

### 4. Start the Server with PM2

```bash
# Start the server
pm2 start server.js --name nfl-pickem

# Save the PM2 process list
pm2 save

# Set PM2 to start on system boot
pm2 startup
# Follow the instructions it gives you (may require running a command with sudo)
```

The server will:
- Initialize the SQLite database automatically (creates `nfl-pickem.db` on first run)
- Run on port 3000
- Restart automatically if it crashes
- Start automatically when the server reboots

Check that it's running:
```bash
pm2 status
```

View logs:
```bash
pm2 logs nfl-pickem
```

### 5. Access from Other Devices

- **Same Computer**: http://localhost:3000
- **Other Devices on Network**: http://192.168.1.x:3000 (use your server's IP)

To find your server's IP address:
```bash
ip addr show
# Look for "inet 192.168.x.x"
```

## Managing the Server

### PM2 Commands

```bash
pm2 status              # Check status
pm2 logs nfl-pickem     # View logs (live tail)
pm2 logs nfl-pickem --lines 100  # View last 100 lines
pm2 restart nfl-pickem  # Restart server (after code changes)
pm2 stop nfl-pickem     # Stop server
pm2 start nfl-pickem    # Start server
pm2 delete nfl-pickem   # Remove from PM2
```

### Updating the Code

When you make changes or pull updates from GitHub:

```bash
cd ~/nfl-pickem
git pull                # Get latest changes
npm install             # Update dependencies if needed
pm2 restart nfl-pickem  # Restart the server
```

## Usage

### Adding Players

1. Click the **+** button to add players for the current week
2. Select from existing players or create a new one
3. Players can be removed by clicking the **×** on their chip

### Making Picks

1. Click on a team logo to select your pick for that game
2. Click again to deselect
3. Picks are saved immediately to the database

### Viewing Leaderboards

1. Click **🏆 Leaderboard** to see season standings
2. Click **Weekly Leaderboard** in the modal for week-by-week results

### Navigation

- **Week Selector**: Use the dropdown or « » arrows to change weeks
- **Season Selector**: Switch between available seasons (years with data in DB)
- **Refresh Scores**: Manually refresh live scores (🔄 button)
- **Print**: Get a clean printout (🖨️ button)

### Admin Mode

- When you try to change picks for a game that already started, you'll get a confirmation
- Confirming activates admin mode (🔓 indicator appears)
- Admin mode allows editing past picks
- Automatically exits when you change weeks

## Database

The SQLite database (`nfl-pickem.db`) stores:
- **players**: All player names
- **week_players**: Which players are active for each week
- **games**: Game schedules, scores, and status
- **picks**: All player picks

The database is automatically created on first run. No manual setup needed.

## API Information

Uses ESPN's free public API:
- **Base URL**: `https://site.api.espn.com/apis/site/v2/sports/football/nfl`
- **Endpoints**:
  - `/scoreboard?week=X&seasontype=2` - Regular season games
  - `/scoreboard?week=X&seasontype=3` - Playoff games
- **No authentication required**
- **Hybrid caching**: Games cached in DB, auto-refresh for in-progress games

## Troubleshooting

### "Cannot find module 'better-sqlite3'"
Make sure you're using Node.js v20 and run:
```bash
npm install
```

### "Port 3000 already in use"
Change the port in `server.js` or stop the other service:
```bash
sudo lsof -i :3000
kill -9 <PID>
```

### Can't access from other devices
- Check firewall: `sudo ufw allow 3000`
- Verify IP address: `ip addr show`
- Ensure devices are on same network

### "No games found for this week"
- Future weeks may not have schedules published yet
- ESPN API might be temporarily unavailable
- Try the refresh button

## Development

### File Structure
- `server.js`: Express routes, database operations
- `public/app.js`: Frontend logic, ESPN API integration
- `public/index.html`: UI structure
- `public/styles.css`: Responsive styling, print styles

### Making Changes
1. Edit files
2. Restart server: `pm2 restart nfl-pickem`
3. Refresh browser

## Backup

The entire application state is in the `nfl-pickem.db` file. To backup:

```bash
# Create a backup
cp ~/nfl-pickem/nfl-pickem.db ~/nfl-pickem-backup-$(date +%Y%m%d).db

# Or copy to another machine
scp username@server:~/nfl-pickem/nfl-pickem.db ~/backups/
```

## License

Free to use and modify for personal use.
