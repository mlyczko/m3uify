# IPTV Manager

Web-based IPTV playlist manager with drag & drop ordering and daily sync.

## Features

- Paste or fetch any M3U playlist
- View channels organized by groups
- Drag & drop to reorder channels and groups
- Serves your custom-ordered playlist at a secret localhost URL
- Auto-syncs the source playlist daily at 04:00 (adds new, removes deleted channels, preserves your ordering)

## Run locally

```bash
npm install
npm start
```

Then open **http://localhost:1234** in your browser.

The playlist URL (for your IPTV player) will be shown in the sidebar, e.g.:

```
http://localhost:1234/your-secret-token
```

## First-time setup

1. Paste your source URL in the **Source M3U** field (e.g. `http://hls.gd/pl/41/b0lyfnlglere8/playlist.m3u8`)
2. Click **Fetch & Set Source** — channels load grouped
3. Drag & drop channels or group headers to reorder
4. Click **Save Order**
5. Copy the playlist URL from the sidebar into your IPTV player

## Docker (for QNAP NAS)

```bash
# Build
docker build -t iptv-manager .

# Run (persist data across restarts)
docker run -d \
  --name iptv-manager \
  -p 1234:1234 \
  -v /path/on/nas/iptv-data:/app/data \
  --restart unless-stopped \
  iptv-manager
```

The secret token is stored in `/app/data/config.json`. Mount that directory to a host path to persist it.

## Config

- Port: set `PORT` env var (default: 1234)
- Data: stored in `./data/` (auto-created)
# m3u-martin
