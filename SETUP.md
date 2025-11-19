# NFL Pick'em - Local Setup Guide

Quick start guide for running on your Mac for development and Ubuntu server for production.

## 🚀 Quick Start (Mac Development)

```bash
cd /Users/robertbrotherton/Documents/nfl-pickem
npm install
npm start
```

Open browser to: **http://localhost:3000**

## 📋 What You Have

- ✅ `server.js` - Express + SQLite backend
- ✅ `public/index.html` - Frontend HTML
- ✅ `public/app.js` - Frontend JavaScript
- ✅ `public/styles.css` - Styles
- ✅ `package.json` - Dependencies

## 🧪 Testing Locally

1. **Start server**: `npm start`
2. **Open**: http://localhost:3000
3. **Add players**: Type names and click "+ Add Player"
4. **Make picks**: Click team buttons
5. **Check leaderboard**: Click "🏆 Leaderboard"

## 🏠 Deploy to Ubuntu Server

### On Ubuntu:

```bash
# Install Node.js
sudo apt update
sudo apt install -y nodejs npm

# Copy project (use git or scp)
cd ~
# ... copy files here ...

# Install and run
npm install
npm start
```

### Access from network:
```
http://192.168.x.x:3000
```

### Keep it running with PM2:

```bash
sudo npm install -g pm2
pm2 start server.js --name nfl-pickem
pm2 startup
pm2 save
```

## 📁 Database

SQLite database is auto-created as `nfl-pickem.db`

**Backup:**
```bash
cp nfl-pickem.db nfl-pickem.db.backup
```

## 🔧 Troubleshooting

**Can't connect from other devices?**
```bash
sudo ufw allow 3000
```

**Port in use?**
```bash
export PORT=8080
npm start
```

**Check logs:**
```bash
pm2 logs nfl-pickem
```

---

That's it! Test on Mac, deploy to Ubuntu when ready. 🏈
