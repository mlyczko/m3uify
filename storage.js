const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'playlist.json');
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

function ensureDataDir() {
    const dir = path.join(__dirname, 'data');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadPlaylist() {
    ensureDataDir();
    if (!fs.existsSync(DATA_FILE)) return { channels: [], groups: [], lastSync: null };
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return { channels: [], groups: [], lastSync: null };
    }
}

function savePlaylist(data) {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadConfig() {
    ensureDataDir();
    if (!fs.existsSync(CONFIG_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveConfig(config) {
    ensureDataDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

module.exports = { loadPlaylist, savePlaylist, loadConfig, saveConfig };
