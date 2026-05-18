# M3Uify

Web-based IPTV playlist manager — fetch, organise, and serve a custom-ordered M3U playlist to your IPTV player.

## Screenshots

**Full UI — sidebar with playlist URL, source & sync controls; toolbar with all actions; groups list**
![Overview](docs/overview.png)

**Expanded group — channels with logos, per-channel move (↪) and toggle (●) buttons, drag handles**
![Channels](docs/channels.png)

**Live search — filter across all groups in real time; matched count shown in toolbar**
![Search](docs/search.png)

## Features

**Playlist management**

- Fetch an M3U playlist from a source URL and serve a clean, reordered copy to your IPTV player
- Channels grouped automatically by `group-title`
- Channel logos displayed with fallback placeholder
- Live search / filter across all channels with real-time match count

**Ordering & organisation**

- Drag & drop to reorder channels within a group
- Drag & drop to reorder groups
- Drag channels across groups (drop onto a group header)
- Move a channel to a different group via the ↪ **Move To** dropdown
- Inline group renaming (✎ button)
- Create custom groups with **＋ New Group**; delete custom groups (🗑 button) — channels are restored to their original group
- Enable/disable individual channels (● toggle per channel)
- Enable/disable entire groups (● toggle per group header) — disabled groups are excluded from the served playlist
- Changes tracked with an unsaved-indicator; persist with **Save Changes**

**Sync**

- **Sync Now** — re-fetches the source and merges changes immediately
- **Auto-sync** — configurable cron schedule (default: daily at 04:00); presets: Daily 4AM · Every 6h · Hourly · Weekly Mon · Manual only
- Smart merge: adds new channels, removes deleted ones, preserves your custom ordering and disabled flags
  - Channels matched by URL, then `tvg-id`, then name — survives token rotations in the source URL
- Rate-limit: automatic background syncs are throttled to at most once every 5 minutes

**Playlist serving**

- Serves your reordered, filtered playlist at a secret token URL: `http://localhost:6767/<token>`
- Disabled groups and disabled channels are excluded from the served M3U automatically
- Token stored in `./data/config.json`; regenerate at any time from the UI (old URL stops working immediately)
- **⬇ Download M3U** — download the current modified playlist as a `.m3u` file

**Backup & restore**

- **⬇ Export** — download a full JSON backup of all settings (channels, groups, disabled state, custom groups, source URL, cron schedule)
- **⬆ Import** — restore from a JSON backup; all settings including the cron schedule are applied immediately without a page reload
- **Reset Everything** — re-fetches the original source, discards all customisations, and resets the schedule to daily 04:00

**Extra M3U attributes** (`timeshift`, `catchup`, etc.) are parsed and round-tripped correctly.

## Run locally

```bash
nvm use          # switches to the pinned Node version (.nvmrc)
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
3. Organise channels and groups to your preference:
   - Drag to reorder within or across groups
   - Toggle groups/channels on or off with ●
   - Rename groups with ✎; create new groups with ＋ New Group
4. Click **Save Changes**
5. Copy the playlist URL from the sidebar into your IPTV player

## API

| Method | Path                    | Description                                         |
| ------ | ----------------------- | --------------------------------------------------- |
| `GET`  | `/api/playlist`         | Current playlist state + token                      |
| `POST` | `/api/source`           | Set source URL and sync                             |
| `POST` | `/api/import`           | Import M3U text or URL (merges into existing)       |
| `POST` | `/api/save`             | Persist channel/group order, disabled flags         |
| `POST` | `/api/sync`             | Force re-sync from saved source URL                 |
| `POST` | `/api/reset`            | Reset to original source; clears all customisations |
| `GET`  | `/api/download`         | Download modified playlist as `playlist.m3u`        |
| `GET`  | `/api/backup/export`    | Download full JSON backup of all settings           |
| `POST` | `/api/backup/import`    | Restore from a JSON backup                          |
| `GET`  | `/api/cron`             | Get current auto-sync schedule                      |
| `POST` | `/api/cron`             | Set auto-sync schedule (`{ expression }`)           |
| `GET`  | `/api/token`            | Get current token and playlist URL                  |
| `POST` | `/api/token/regenerate` | Generate a new secret token                         |
| `GET`  | `/:token`               | Serve the filtered playlist as `audio/x-mpegurl`    |

## Docker

### Pull from Docker Hub

```bash
docker run -d \
  --name m3uify \
  -p 6767:6767 \
  -v /path/to/iptv-data:/app/data \
  --restart unless-stopped \
  yourusername/m3uify:latest
```

### Build locally

```bash
docker build -t m3uify .

docker run -d \
  --name m3uify \
  -p 6767:6767 \
  -v /path/to/iptv-data:/app/data \
  --restart unless-stopped \
  m3uify
```

### Docker Compose

```bash
docker compose up -d
```

The secret token is stored in `/app/data/config.json`. Mount that directory to a host path to keep it across container recreations.

### Releases

Every push to `main` automatically builds and pushes a versioned image to Docker Hub via GitHub Actions (e.g. `yourusername/m3uify:1.0.1` and `yourusername/m3uify:latest`). The image version tracks `package.json`, which is auto-incremented on each commit.

## Configuration

| Setting            | How to set                             | Default                   |
| ------------------ | -------------------------------------- | ------------------------- |
| Port               | `PORT` env var                         | `6767`                    |
| Data directory     | hardcoded `./data/`                    | auto-created              |
| Auto-sync schedule | UI → Sync section, or `POST /api/cron` | `0 4 * * *` (daily 04:00) |
