const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { parseM3U, serializeM3U } = require('./m3uParser');
const { loadPlaylist, savePlaylist, loadConfig, saveConfig } = require('./storage');

const { version: APP_VERSION } = require('./package.json');

const app = express();
const PORT = process.env.PORT || 6767;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

app.use(express.json({ limit: '50mb' }));

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

// ─── Auth ───────────────────────────────────────────────────────────────────

const AUTH_COOKIE = 'm3uify_auth';
const UUID_RE = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns { enabled, managedByEnv, hash? }
function getAuthState() {
    if (ADMIN_PASSWORD) return { enabled: true, managedByEnv: true };
    const config = loadConfig();
    return { enabled: !!config.passwordHash, managedByEnv: false, hash: config.passwordHash || null };
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
    return `pbkdf2:${salt}:${hash}`;
}

function verifyPassword(provided, stored) {
    if (!stored || !stored.startsWith('pbkdf2:')) return false;
    const [, salt, expectedHash] = stored.split(':');
    const candidateHash = crypto.pbkdf2Sync(provided, salt, 100000, 64, 'sha256').toString('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(expectedHash, 'hex'));
    } catch { return false; }
}

function verifyLogin(provided) {
    if (!provided) return false;
    const auth = getAuthState();
    if (!auth.enabled) return false;
    if (auth.managedByEnv) {
        try {
            return provided.length === ADMIN_PASSWORD.length &&
                crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(ADMIN_PASSWORD));
        } catch { return false; }
    }
    return verifyPassword(provided, auth.hash);
}

function parseCookies(req) {
    const out = {};
    const h = req.headers.cookie;
    if (!h) return out;
    h.split(';').forEach(part => {
        const [k, ...v] = part.split('=');
        out[k.trim()] = decodeURIComponent(v.join('=').trim());
    });
    return out;
}

function getOrCreateSessionSecret() {
    const config = loadConfig();
    if (!config.sessionSecret) {
        config.sessionSecret = crypto.randomBytes(32).toString('hex');
        saveConfig(config);
    }
    return config.sessionSecret;
}

// Token is HMAC of the current credential — changes when password changes, invalidating old cookies
function makeAuthToken() {
    const secret = getOrCreateSessionSecret();
    const auth = getAuthState();
    const key = auth.managedByEnv ? ADMIN_PASSWORD : (auth.hash || '');
    return crypto.createHmac('sha256', secret).update(key).digest('hex');
}

function isValidCookie(value) {
    if (!value || value.length !== 64) return false;
    try {
        const expected = makeAuthToken();
        return crypto.timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
    } catch { return false; }
}

const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function checkLoginRateLimit(ip) {
    const now = Date.now();
    const e = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    if (e.lockedUntil > now) return { allowed: false, waitMs: e.lockedUntil - now };
    return { allowed: true };
}

function recordFailedLogin(ip) {
    const e = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    e.count++;
    if (e.count >= MAX_LOGIN_ATTEMPTS) {
        e.lockedUntil = Date.now() + LOCKOUT_MS;
        e.count = 0;
        console.warn(`Login locked for IP ${ip} (15 min)`);
    }
    loginAttempts.set(ip, e);
}

function clearLoginAttempts(ip) { loginAttempts.delete(ip); }

function authMiddleware(req, res, next) {
    if (!getAuthState().enabled) return next();
    if (req.path === '/login' || req.path.startsWith('/auth/')) return next();
    if (req.path === '/livereload') return next(); // dev SSE — always public
    if (UUID_RE.test(req.path)) return next(); // IPTV players — no cookie support
    const cookies = parseCookies(req);
    if (isValidCookie(cookies[AUTH_COOKIE])) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorised' });
    res.redirect('/login');
}

// ─── Dev live-reload (SSE) ──────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
    app.get('/livereload', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        res.write('data: connected\n\n');
        // Keep alive ping every 20s
        const ping = setInterval(() => res.write(':ping\n\n'), 20000);
        req.on('close', () => clearInterval(ping));
    });
}

app.get('/login', (req, res) => {
    if (!getAuthState().enabled) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/auth/login', (req, res) => {
    const ip = req.ip;
    const rl = checkLoginRateLimit(ip);
    if (!rl.allowed) {
        const mins = Math.ceil(rl.waitMs / 60000);
        return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute(s).` });
    }
    if (!getAuthState().enabled) return res.json({ ok: true });
    const { password, remember } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password required' });
    if (!verifyLogin(password)) {
        recordFailedLogin(ip);
        return res.status(401).json({ error: 'Incorrect password' });
    }
    clearLoginAttempts(ip);
    const tokenVal = makeAuthToken();
    const maxAge = remember ? 30 * 24 * 60 * 60 : undefined;
    const cookie = `${AUTH_COOKIE}=${tokenVal}; HttpOnly; SameSite=Strict; Path=/${maxAge ? `; Max-Age=${maxAge}` : ''}`;
    res.setHeader('Set-Cookie', cookie);
    res.json({ ok: true });
});

app.get('/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.redirect('/login');
});

app.use(authMiddleware);
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (/\.(html|js|css)$/.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

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
    res.json({ ...playlist, token: config.token, version: APP_VERSION, authEnabled: getAuthState().enabled, managedByEnv: getAuthState().managedByEnv });
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
        const updated = await fetchAndSync(sourceUrl, true); // force=true: user action, skip rate limit
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

// Clear playlist — wipe all data, keep token
app.post('/api/clear', (req, res) => {
    const empty = { channels: [], groups: [], disabledGroups: [], customGroups: [], sourceUrl: null, lastSync: null };
    savePlaylist(empty);
    const config = loadConfig();
    config.cronExpression = DEFAULT_CRON;
    saveConfig(config);
    startCron(DEFAULT_CRON);
    console.log('Playlist cleared.');
    res.json({ ...empty, token: config.token, cronExpression: DEFAULT_CRON });
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

// Set / change / remove dashboard password
app.post('/api/auth/password', (req, res) => {
    const auth = getAuthState();
    if (auth.managedByEnv) {
        return res.status(400).json({ error: 'Password is managed by the ADMIN_PASSWORD environment variable and cannot be changed here.' });
    }
    const { currentPassword, newPassword } = req.body || {};
    // If a password is already set, require the current one
    if (auth.enabled) {
        if (!verifyPassword(currentPassword, auth.hash)) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
    }
    const config = loadConfig();
    if (newPassword) {
        config.passwordHash = hashPassword(newPassword);
        saveConfig(config);
        // Invalidate all existing sessions by rotating the session secret
        config.sessionSecret = crypto.randomBytes(32).toString('hex');
        saveConfig(config);
        console.log('Dashboard password updated');
        res.json({ ok: true, authEnabled: true });
    } else {
        // Empty newPassword = remove protection
        delete config.passwordHash;
        config.sessionSecret = crypto.randomBytes(32).toString('hex');
        saveConfig(config);
        // Clear the caller's cookie
        res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
        console.log('Dashboard password removed');
        res.json({ ok: true, authEnabled: false });
    }
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

console.log(`\nM3Uify v${APP_VERSION}`);
startCron(initialConfig.cronExpression || DEFAULT_CRON);

app.listen(PORT, () => {
    console.log(`IPTV Manager running at http://localhost:${PORT}`);
    console.log(`Web GUI:      http://localhost:${PORT}/`);
    console.log(`Playlist URL: http://localhost:${PORT}/${token}\n`);
});
