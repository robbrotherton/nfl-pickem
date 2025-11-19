# NFL Pick'em Website

A simple, printable NFL pick'em sheet that fetches live NFL schedules and standings from ESPN's free API.

## Project Structure

```
nfl-pickem/
├── index.html          # Main HTML page
├── styles.css          # All styling and print styles
├── app.js              # JavaScript for data fetching and rendering
└── README.md           # This file
```

## Features

- 📅 Weekly NFL schedule with game times
- 🏈 Current win-loss records for all teams
- 👥 4 customizable player columns for picks
- 🖨️ Print-optimized layout perfect for kids
- 💾 Saves player names locally in browser
- 🔄 Select any week of the season
- 🆓 **Completely free** - uses ESPN's public API, no API key required!

## Setup

### No API Key Needed!

This app now uses ESPN's free public API, so you don't need to sign up for anything or configure an API key. Just host it and use it!

You have several options to host this locally:

#### Option A: Using Python (Simplest)

1. SSH into your Ubuntu server
2. Navigate to the project directory:
   ```bash
   cd /path/to/nfl-pickem
   ```
3. Start a simple HTTP server:
   ```bash
   python3 -m http.server 8080
   ```
4. Access from any device on your network: `http://192.168.1.x:8080/index.html`

#### Option B: Using Nginx (Production-ready)

1. Install nginx:
   ```bash
   sudo apt update
   sudo apt install nginx
   ```

2. Create a site configuration:
   ```bash
   sudo nano /etc/nginx/sites-available/pickem
   ```

3. Add this configuration:
   ```nginx
   server {
       listen 80;
       server_name 192.168.1.x;  # Replace with your server's IP
       
       location /pickem {
           alias /home/yourusername/nfl-pickem;
           index index.html;
       }
   }
   ```

4. Enable the site:
   ```bash
   sudo ln -s /etc/nginx/sites-available/pickem /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

5. Access at: `http://192.168.1.x/pickem`

#### Option C: Using Apache

1. Install Apache:
   ```bash
   sudo apt update
   sudo apt install apache2
   ```

2. Copy files to web directory:
   ```bash
   sudo mkdir -p /var/www/html/pickem
   sudo cp -r /path/to/nfl-pickem/* /var/www/html/pickem/
   ```

3. Access at: `http://192.168.1.x/pickem`

## Usage

1. Open the page in your browser
2. The current week will load automatically
3. Select a different week if needed using the dropdown
4. Enter player names in the input fields (they'll be saved automatically)
5. Click "Load Schedule" if you change the week
6. Click "Print" to get a clean printout with empty cells for writing picks

## How to Print

1. Click the "Print" button or press `Ctrl+P` (Windows/Linux) or `Cmd+P` (Mac)
2. In the print dialog:
   - Select "Portrait" or "Landscape" orientation (landscape recommended)
   - Adjust margins if needed
   - Ensure "Background graphics" is enabled for borders
3. Print or save as PDF

## Notes

- Player names are saved in your browser's local storage
- The API has rate limits - don't refresh too frequently
- Season year defaults to 2024 but can be changed
- Week selection ranges from 1-18 (regular season)

## Troubleshooting

**"No games found for this week"**
- Try a different week
- Some future weeks may not have schedules published yet
- Past seasons are available too (ESPN has historical data)

**Can't access from other devices**
- Make sure your server's firewall allows the port (8080, 80, etc.)
- Check that you're using the correct IP address of your Ubuntu server
- Ensure both devices are on the same network

## API Information

This app uses ESPN's free public API:
- Base URL: `https://site.api.espn.com/apis/site/v2/sports/football/nfl`
- Endpoints used:
  - `/scoreboard?week=X&seasontype=2` - Get schedule for specific week
  - `/standings` - Get team records
- No authentication required
- No rate limits for reasonable use

## License

Free to use and modify for personal use.
