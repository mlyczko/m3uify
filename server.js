const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { parseM3U, serializeM3U } = require('./m3uParser');
const { loadPlaylist, savePlaylist, loadConfig, saveConfig } = require('./storage');

const app = express();
const PORT = process.env.PORT || 1234;

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
    const existingByUrl = new Map(existing.map(ch => [ch.url, ch]));

    // Remove channels no longer in source
    const kept = existing.filter(ch => freshByUrl.has(ch.url));

    // Add new channels at the end
    const keptUrls = new Set(kept.map(ch => ch.url));
    const added = fresh.filter(ch => !keptUrls.has(ch.url));

    // Assign stable ids
    const merged = [...kept, ...added].map((ch, idx) => ({
        id: ch.id || uuidv4(),
        name: ch.name,
        group: ch.group,
        logo: ch.logo,
        tvgId: ch.tvgId,
        tvgName: ch.tvgName,
        url: ch.url,
        order: idx,
    }));

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

async function fetchAndSync(sourceUrl) {
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
    const { channels, groups } = playlist;

    // Sort channels: by group order, then by channel order
    const groupIndex = new Map((groups || []).map((g, i) => [g, i]));
    const sorted = [...(channels || [])].sort((a, b) => {
        const gi = (groupIndex.get(a.group) ?? 9999) - (groupIndex.get(b.group) ?? 9999);
        if (gi !== 0) return gi;
        return (a.order ?? 0) - (b.order ?? 0);
    });

    const m3u = serializeM3U(sorted);
    res.setHeader('Content-Type', 'audio/x-mpegurl');
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
        const { channels, groups } = req.body;
        if (!Array.isArray(channels) || !Array.isArray(groups)) {
            return res.status(400).json({ error: 'channels and groups arrays required' });
        }
        const playlist = loadPlaylist();
        // Reassign order based on position
        const reordered = channels.map((ch, idx) => ({ ...ch, order: idx }));
        const updated = { ...playlist, channels: reordered, groups };
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
        const updated = await fetchAndSync(playlist.sourceUrl);
        const config = loadConfig();
        res.json({ ...updated, token: config.token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Get token info
app.get('/api/token', (req, res) => {
    const token = getOrCreateToken();
    res.json({ token, url: `http://localhost:${PORT}/${token}` });
});

// ─── Daily sync cron ────────────────────────────────────────────────────────

// Run every day at 04:00
cron.schedule('0 4 * * *', async () => {
    const playlist = loadPlaylist();
    if (playlist.sourceUrl) {
        try {
            await fetchAndSync(playlist.sourceUrl);
        } catch (err) {
            console.error('Daily sync failed:', err.message);
        }
    }
});

// ─── Start ──────────────────────────────────────────────────────────────────

const token = getOrCreateToken();
app.listen(PORT, () => {
    console.log(`\nIPTV Manager running at http://localhost:${PORT}`);
    console.log(`Web GUI:      http://localhost:${PORT}/`);
    console.log(`Playlist URL: http://localhost:${PORT}/${token}\n`);
});
