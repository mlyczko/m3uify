const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { parseM3U, serializeM3U } = require('./m3uParser');
const { loadPlaylist, savePlaylist, loadConfig, saveConfig } = require('./storage');

const app = express();
const PORT = process.env.PORT || 6767;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ────────────────────────────────────────────────────────────────

function getOrCreateToken() {
    let config = loadConfig();
    if (!config.token) {
        config.token = uuidv4();
        saveConfig(config);
        console.log(`Generated playlist token: ${config.token}`);
    }
    return config.token;
}

/**
 * Merge freshly fetched channels into existing playlist:
 * - Add new channels (not present by URL)
 * - Remove channels whose URL is no longer in source
 * - Preserve user ordering for existing channels
 */
function mergeChannels(existing, fresh) {
    const freshByUrl = new Map(fresh.map(ch => [ch.url, ch]));
    // Fallback match by tvg-id (non-empty) or name — handles token/URL changes in same list
    const freshByTvgId = new Map(
        fresh.filter(ch => ch.tvgId).map(ch => [ch.tvgId, ch])
    );
    const freshByName = new Map(fresh.map(ch => [ch.name, ch]));

    function findFresh(ch) {
        return freshByUrl.get(ch.url)
            || (ch.tvgId && freshByTvgId.get(ch.tvgId))
            || freshByName.get(ch.name)
            || null;
    }

    // Keep existing channels that still exist in fresh (by URL, tvg-id, or name)
    const kept = existing.filter(ch => findFresh(ch) !== null);

    // New channels: in fresh but not matched by any existing channel
    const matchedFreshUrls = new Set();
    kept.forEach(ch => {
        const f = findFresh(ch);
        if (f) matchedFreshUrls.add(f.url);
    });
    const added = fresh.filter(ch => !matchedFreshUrls.has(ch.url));

    // Assign stable ids, update stream URL and attributes from fresh
    const merged = [...kept, ...added].map((ch, idx) => {
        const freshCh = findFresh(ch) || ch;
        return {
            id: ch.id || uuidv4(),
            name: freshCh.name,
            group: ch.group,  // preserve user-renamed group
            originalGroup: ch.originalGroup || freshCh.group,  // always the source group
            logo: freshCh.logo,
            tvgId: freshCh.tvgId,
            tvgName: freshCh.tvgName,
            extraAttrs: freshCh.extraAttrs || '',
            url: freshCh.url,  // always use fresh URL (token may have changed)
            order: ch.order ?? idx,
            disabled: ch.disabled || false,  // preserve user's disabled flag
        };
    });

    return merged;
}

function buildGroupOrder(channels, existingGroups) {
    const seen = new Set(existingGroups);
    const groups = [...existingGroups];
    for (const ch of channels) {
        if (!seen.has(ch.group)) {
            seen.add(ch.group);
            groups.push(ch.group);
        }
    }
    // Remove groups that no longer have channels
    const activeGroups = new Set(channels.map(ch => ch.group));
    return groups.filter(g => activeGroups.has(g));
}

const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastSyncTime = 0;

async function fetchAndSync(sourceUrl, force = false) {
    const now = Date.now();
    if (!force && now - lastSyncTime < MIN_SYNC_INTERVAL_MS) {
        const wait = Math.ceil((MIN_SYNC_INTERVAL_MS - (now - lastSyncTime)) / 1000);
        throw new Error(`Too soon — last sync was ${Math.floor((now - lastSyncTime) / 1000)}s ago. Wait ${wait}s or use manual Sync Now.`);
    }
    lastSyncTime = now;
    console.log(`Syncing from ${sourceUrl}...`);
    const res = await fetch(sourceUrl, { timeout: 30000 });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const text = await res.text();
    const fresh = parseM3U(text);

    const playlist = loadPlaylist();
    const merged = mergeChannels(playlist.channels || [], fresh);
    const groups = buildGroupOrder(merged, playlist.groups || []);

    const updated = {
        channels: merged,
        groups,
        sourceUrl,
        lastSync: new Date().toISOString(),
    };
    savePlaylist(updated);
    console.log(`Sync complete. ${merged.length} channels, ${groups.length} groups.`);
    return updated;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Serve the public playlist in M3U format
app.get('/:token', (req, res) => {
    const config = loadConfig();
    if (req.params.token !== config.token) {
        return res.status(404).send('Not found');
    }
    const playlist = loadPlaylist();
    const { channels, groups, disabledGroups = [] } = playlist;
    const disabledSet = new Set(disabledGroups);

    // Sort channels: by group order, then by channel order; exclude disabled groups
    const groupIndex = new Map((groups || []).map((g, i) => [g, i]));
    const sorted = [...(channels || [])]
        .filter(ch => !disabledSet.has(ch.group) && !ch.disabled)
        .sort((a, b) => {
            const gi = (groupIndex.get(a.group) ?? 9999) - (groupIndex.get(b.group) ?? 9999);
            if (gi !== 0) return gi;
            return (a.order ?? 0) - (b.order ?? 0);
        });

    const m3u = serializeM3U(sorted);
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.send(m3u);
});

// Download modified M3U as a file
app.get('/api/download', (req, res) => {
    const playlist = loadPlaylist();
    const { channels, groups, disabledGroups = [] } = playlist;
    const disabledSet = new Set(disabledGroups);
    const groupIndex = new Map((groups || []).map((g, i) => [g, i]));
    const sorted = [...(channels || [])]
        .filter(ch => !disabledSet.has(ch.group) && !ch.disabled)
        .sort((a, b) => {
            const gi = (groupIndex.get(a.group) ?? 9999) - (groupIndex.get(b.group) ?? 9999);
            if (gi !== 0) return gi;
            return (a.order ?? 0) - (b.order ?? 0);
        });
    const m3u = serializeM3U(sorted);
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u"');
    res.send(m3u);
});

// ─── API ─────────────────────────────────────────────────────────────────────

// Get current state
app.get('/api/playlist', (req, res) => {
    const playlist = loadPlaylist();
    const config = loadConfig();
    res.json({ ...playlist, token: config.token });
});

// Import M3U text manually
app.post('/api/import', async (req, res) => {
    try {
        const { text, sourceUrl } = req.body;
        if (!text && !sourceUrl) return res.status(400).json({ error: 'Provide text or sourceUrl' });

        let fresh;
        let resolvedUrl = sourceUrl;

        if (sourceUrl) {
            const fetchRes = await fetch(sourceUrl, { timeout: 30000 });
            if (!fetchRes.ok) return res.status(502).json({ error: `Fetch failed: ${fetchRes.status}` });
            const fetched = await fetchRes.text();
            fresh = parseM3U(fetched);
        } else {
            fresh = parseM3U(text);
        }

        const playlist = loadPlaylist();
        const merged = mergeChannels(playlist.channels || [], fresh);
        const groups = buildGroupOrder(merged, playlist.groups || []);

        const updated = {
            channels: merged,
            groups,
            sourceUrl: resolvedUrl || playlist.sourceUrl || null,
            lastSync: new Date().toISOString(),
        };
        savePlaylist(updated);

        const config = loadConfig();
        res.json({ ...updated, token: config.token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Save reordered channels + groups
app.post('/api/save', (req, res) => {
    try {
        const { channels, groups, disabledGroups, customGroups } = req.body;
        if (!Array.isArray(channels) || !Array.isArray(groups)) {
            return res.status(400).json({ error: 'channels and groups arrays required' });
        }
        const playlist = loadPlaylist();
        const reordered = channels.map((ch, idx) => ({ ...ch, order: idx }));
        const updated = {
            ...playlist, channels: reordered, groups,
            disabledGroups: Array.isArray(disabledGroups) ? disabledGroups : (playlist.disabledGroups || []),
            customGroups: Array.isArray(customGroups) ? customGroups : (playlist.customGroups || []),
        };
        savePlaylist(updated);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Set source URL
app.post('/api/source', async (req, res) => {
    try {
        const { sourceUrl } = req.body;
        if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl required' });
        const updated = await fetchAndSync(sourceUrl);
        const config = loadConfig();
        res.json({ ...updated, token: config.token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Manual sync trigger
app.post('/api/sync', async (req, res) => {
    try {
        const playlist = loadPlaylist();
        if (!playlist.sourceUrl) return res.status(400).json({ error: 'No source URL configured' });
        const updated = await fetchAndSync(playlist.sourceUrl, true); // force=true for manual
        const config = loadConfig();
        res.json({ ...updated, token: config.token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Full reset — re-fetch source, discard all custom ordering/disabled flags
app.post('/api/reset', async (req, res) => {
    try {
        const playlist = loadPlaylist();
        if (!playlist.sourceUrl) return res.status(400).json({ error: 'No source URL configured' });
        const sourceUrl = playlist.sourceUrl;
        const res2 = await fetch(sourceUrl, { timeout: 30000 });
        if (!res2.ok) throw new Error(`Fetch failed: ${res2.status}`);
        const text = await res2.text();
        const fresh = parseM3U(text);
        const channels = fresh.map((ch, idx) => ({ ...ch, id: uuidv4(), order: idx, disabled: false, originalGroup: ch.group }));
        const groups = [...new Set(channels.map(ch => ch.group))];
        const reset = { channels, groups, disabledGroups: [], customGroups: [], sourceUrl, lastSync: new Date().toISOString() };
        savePlaylist(reset);
        const config = loadConfig();
        config.cronExpression = DEFAULT_CRON;
        saveConfig(config);
        startCron(DEFAULT_CRON);
        console.log(`Reset complete. ${channels.length} channels, ${groups.length} groups.`);
        res.json({ ...reset, token: config.token, cronExpression: DEFAULT_CRON });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Export / Import ─────────────────────────────────────────────────────────

app.get('/api/backup/export', (req, res) => {
    const playlist = loadPlaylist();
    const config = loadConfig();
    const bundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        playlist,
        config: { cronExpression: config.cronExpression || DEFAULT_CRON },
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="m3uify-backup-${Date.now()}.json"`);
    res.json(bundle);
});

app.post('/api/backup/import', (req, res) => {
    const bundle = req.body;
    if (!bundle || !bundle.playlist || !Array.isArray(bundle.playlist.channels)) {
        return res.status(400).json({ error: 'Invalid backup file' });
    }
    savePlaylist(bundle.playlist);
    if (bundle.config) {
        const config = loadConfig();
        if (bundle.config.cronExpression) {
            config.cronExpression = bundle.config.cronExpression;
            saveConfig(config);
            startCron(config.cronExpression);
        }
    }
    const config = loadConfig();
    res.json({ ...bundle.playlist, token: config.token, cronExpression: config.cronExpression || DEFAULT_CRON });
});

// Get token info
app.get('/api/token', (req, res) => {
    const token = getOrCreateToken();
    res.json({ token, url: `http://localhost:${PORT}/${token}` });
});

// Regenerate token
app.post('/api/token/regenerate', (req, res) => {
    const config = loadConfig();
    config.token = uuidv4();
    saveConfig(config);
    res.json({ token: config.token, url: `http://localhost:${PORT}/${config.token}` });
});

// ─── Configurable sync cron ─────────────────────────────────────────────────

const DEFAULT_CRON = '0 4 * * *';
let activeCronTask = null;

function startCron(expression) {
    if (activeCronTask) {
        activeCronTask.stop();
        activeCronTask = null;
    }
    if (!expression || expression === 'manual') return;
    if (!cron.validate(expression)) {
        console.error('Invalid cron expression:', expression);
        return;
    }
    activeCronTask = cron.schedule(expression, async () => {
        console.log(`Cron triggered [${expression}]`);
        const playlist = loadPlaylist();
        if (playlist.sourceUrl) {
            try {
                await fetchAndSync(playlist.sourceUrl);
            } catch (err) {
                console.error('Cron sync failed:', err.message);
            }
        }
    });
    console.log(`Cron scheduled: ${expression}`);
}

// GET current cron config
app.get('/api/cron', (req, res) => {
    const config = loadConfig();
    res.json({ expression: config.cronExpression || DEFAULT_CRON });
});

// POST new cron config
app.post('/api/cron', (req, res) => {
    const { expression } = req.body;
    if (!expression) return res.status(400).json({ error: 'expression required' });
    if (expression !== 'manual' && !cron.validate(expression)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
    }
    const config = loadConfig();
    config.cronExpression = expression;
    saveConfig(config);
    startCron(expression);
    res.json({ ok: true, expression });
});

// ─── Start ──────────────────────────────────────────────────────────────────

const token = getOrCreateToken();
const initialConfig = loadConfig();
startCron(initialConfig.cronExpression || DEFAULT_CRON);

app.listen(PORT, () => {
    console.log(`\nIPTV Manager running at http://localhost:${PORT}`);
    console.log(`Web GUI:      http://localhost:${PORT}/`);
    console.log(`Playlist URL: http://localhost:${PORT}/${token}\n`);
});
