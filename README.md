# M3Uify

Web-based IPTV playlist manager — fetch, organise, and serve a custom-ordered M3U playlist to your IPTV player.

## Screenshots

**Group overview — sidebar with playlist URL, source & sync controls**
![Overview](docs/overview.png)

**Expanded group — channels with logos, drag handles**
![Channels](docs/channels.png)

**Live search — filter across all groups in real time**
![Search](docs/search.png)

## Features

**Playlist management**

- Fetch an M3U playlist from a URL or paste raw M3U text
- Channels grouped automatically by `group-title`
- Channel logos displayed with fallback placeholder
- Live search / filter across all channels

**Ordering & organisation**

- Drag & drop to reorder channels within a group
- Drag & drop to reorder groups
- Inline group renaming
- Changes tracked with an unsaved-indicator; persist with **Save Changes**

**Sync**

- **Sync Now** — re-fetches the source and merges changes immediately (force, ignores rate limit)
- **Auto-sync** — configurable cron schedule (default: daily at 04:00); presets: Daily 4AM · Every 6h · Hourly · Weekly Mon · Manual only
- Smart merge: adds new channels, removes deleted ones, preserves your custom ordering
  - Channels matched by URL, then `tvg-id`, then name — survives token rotations in the source URL
- Rate-limit: automatic background syncs are throttled to at most once every 5 minutes

**Playlist serving**

- Serves your reordered playlist at a secret token URL: `http://localhost:6767/<token>`
- Token stored in `./data/config.json`; regenerate at any time from the UI (old URL stops working immediately)
- One-click copy of the playlist URL

**Extra M3U attributes** (`timeshift`, `catchup`, etc.) are parsed and round-tripped correctly.

## Run locally

```bash
npm install
npm start
```

Open **http://localhost:6767** in your browser.

For development with auto-restart:

```bash
npm run dev
```

## First-time setup

1. Paste your source M3U URL into the **Source M3U** field in the sidebar
2. Click **Fetch & Set Source** — channels load grouped
3. Drag channels and group headers to your preferred order; rename groups with the ✎ button
4. Click **Save Changes**
5. Copy the playlist URL from the sidebar into your IPTV player

## API

| Method | Path                    | Description                                   |
| ------ | ----------------------- | --------------------------------------------- |
| `GET`  | `/api/playlist`         | Current playlist state + token                |
| `POST` | `/api/source`           | Set source URL and sync                       |
| `POST` | `/api/import`           | Import M3U text or URL (merges into existing) |
| `POST` | `/api/save`             | Persist channel/group order                   |
| `POST` | `/api/sync`             | Force re-sync from saved source URL           |
| `GET`  | `/api/cron`             | Get current auto-sync schedule                |
| `POST` | `/api/cron`             | Set auto-sync schedule (`{ expression }`)     |
| `GET`  | `/api/token`            | Get current token and playlist URL            |
| `POST` | `/api/token/regenerate` | Generate a new secret token                   |
| `GET`  | `/:token`               | Serve the playlist as `audio/x-mpegurl`       |

## Docker

```bash
# Build
docker build -t m3uify .

# Run (persist data across restarts)
docker run -d \
  --name m3uify \
  -p 6767:6767 \
  -v /path/to/iptv-data:/app/data \
  --restart unless-stopped \
  m3uify
```

The secret token is stored in `/app/data/config.json`. Mount that directory to a host path to keep it across container recreations.

## Configuration

| Setting            | How to set                             | Default                   |
| ------------------ | -------------------------------------- | ------------------------- |
| Port               | `PORT` env var                         | `6767`                    |
| Data directory     | hardcoded `./data/`                    | auto-created              |
| Auto-sync schedule | UI → Sync section, or `POST /api/cron` | `0 4 * * *` (daily 04:00) |
