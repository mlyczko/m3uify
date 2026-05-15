// ─── State ───────────────────────────────────────────────────────────────────
let state = {
    channels: [],
    groups: [],
    token: null,
    sourceUrl: null,
    lastSync: null,
    dirty: false,
};

// ─── DOM refs ────────────────────────────────────────────────────────────────
const groupsContainer = document.getElementById('groups-container');
const emptyState = document.getElementById('empty-state');
const saveBtn = document.getElementById('save-btn');
const searchInput = document.getElementById('search-input');
const channelCount = document.getElementById('channel-count');
const playlistUrlText = document.getElementById('playlist-url-text');
const copyUrlBtn = document.getElementById('copy-url-btn');
const sourceUrlInput = document.getElementById('source-url-input');
const fetchSourceBtn = document.getElementById('fetch-source-btn');
const m3uPasteArea = document.getElementById('m3u-paste-area');
const importPasteBtn = document.getElementById('import-paste-btn');
const syncNowBtn = document.getElementById('sync-now-btn');
const lastSyncInfo = document.getElementById('last-sync-info');

// ─── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ─── API helpers ────────────────────────────────────────────────────────────
async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
}

// ─── Load playlist ──────────────────────────────────────────────────────────
async function loadPlaylist() {
    const data = await api('GET', '/playlist');
    applyState(data);
}

function applyState(data) {
    state.channels = data.channels || [];
    state.groups = data.groups || [];
    state.token = data.token;
    state.sourceUrl = data.sourceUrl || null;
    state.lastSync = data.lastSync || null;
    state.dirty = false;

    if (state.token) {
        const url = `${location.origin}/${state.token}`;
        playlistUrlText.textContent = url;
    }

    if (state.sourceUrl) sourceUrlInput.value = state.sourceUrl;
    updateLastSync();
    markDirty(false);
    renderAll();
}

function updateLastSync() {
    if (state.lastSync) {
        const d = new Date(state.lastSync);
        lastSyncInfo.textContent = 'Last sync: ' + d.toLocaleString();
    } else {
        lastSyncInfo.textContent = 'Last sync: —';
    }
}

// ─── Render ──────────────────────────────────────────────────────────────────
function renderAll() {
    groupsContainer.innerHTML = '';

    if (!state.channels.length) {
        emptyState.classList.remove('hidden');
        channelCount.textContent = '';
        return;
    }

    emptyState.classList.add('hidden');

    // Group channels by group name, maintaining group order
    const channelsByGroup = new Map();
    for (const g of state.groups) channelsByGroup.set(g, []);
    for (const ch of state.channels) {
        if (!channelsByGroup.has(ch.group)) channelsByGroup.set(ch.group, []);
        channelsByGroup.get(ch.group).push(ch);
    }

    const search = searchInput.value.trim().toLowerCase();
    let totalVisible = 0;

    for (const [groupName, channels] of channelsByGroup) {
        if (!channels.length) continue;
        const card = renderGroup(groupName, channels, search);
        groupsContainer.appendChild(card);
        const visible = channels.filter(ch => !search || ch.name.toLowerCase().includes(search));
        totalVisible += visible.length;
    }

    channelCount.textContent = `${state.channels.length} channels · ${state.groups.length} groups`;
    if (search) channelCount.textContent += ` · ${totalVisible} matching`;

    initGroupDrag();
}

function renderGroup(groupName, channels, search) {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.dataset.group = groupName;

    const header = document.createElement('div');
    header.className = 'group-header';
    header.draggable = true;
    header.innerHTML = `
    <span class="drag-handle">⠿</span>
    <span class="group-title">${escapeHtml(groupName)}</span>
    <span class="group-count">${channels.length}</span>
    <button class="group-toggle" title="Collapse">▼</button>
  `;

    const list = document.createElement('ul');
    list.className = 'channel-list';
    list.dataset.group = groupName;

    for (const ch of channels) {
        const item = renderChannel(ch, search);
        list.appendChild(item);
    }

    const toggleBtn = header.querySelector('.group-toggle');
    let collapsed = true;
    list.style.display = 'none';
    toggleBtn.textContent = '▶';
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        collapsed = !collapsed;
        list.style.display = collapsed ? 'none' : '';
        toggleBtn.textContent = collapsed ? '▶' : '▼';
    });

    card.appendChild(header);
    card.appendChild(list);

    initChannelDrag(list);
    return card;
}

function renderChannel(ch, search) {
    const li = document.createElement('li');
    li.className = 'channel-item';
    li.draggable = true;
    li.dataset.id = ch.id;

    if (search && !ch.name.toLowerCase().includes(search)) {
        li.classList.add('hidden-by-search');
    }

    const logoEl = ch.logo
        ? `<img class="channel-logo" src="${escapeHtml(ch.logo)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="" /><div class="channel-logo-placeholder" style="display:none">📺</div>`
        : `<div class="channel-logo-placeholder">📺</div>`;

    li.innerHTML = `
    ${logoEl}
    <span class="channel-name">${escapeHtml(ch.name)}</span>
    <span class="channel-drag-handle">⠿</span>
  `;
    return li;
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Drag & Drop — Groups ────────────────────────────────────────────────────
function initGroupDrag() {
    const cards = groupsContainer.querySelectorAll('.group-card');
    let dragSrc = null;

    cards.forEach(card => {
        const header = card.querySelector('.group-header');

        header.addEventListener('dragstart', e => {
            dragSrc = card;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.group);
        });

        header.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            cards.forEach(c => c.classList.remove('group-drag-over'));
            dragSrc = null;
        });

        card.addEventListener('dragover', e => {
            if (!dragSrc || dragSrc === card) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            cards.forEach(c => c.classList.remove('group-drag-over'));
            card.classList.add('group-drag-over');
        });

        card.addEventListener('dragleave', () => {
            card.classList.remove('group-drag-over');
        });

        card.addEventListener('drop', e => {
            e.preventDefault();
            if (!dragSrc || dragSrc === card) return;
            card.classList.remove('group-drag-over');

            const allCards = [...groupsContainer.querySelectorAll('.group-card')];
            const srcIdx = allCards.indexOf(dragSrc);
            const dstIdx = allCards.indexOf(card);

            if (srcIdx < dstIdx) {
                card.after(dragSrc);
            } else {
                card.before(dragSrc);
            }

            // Update state.groups order
            const newOrder = [...groupsContainer.querySelectorAll('.group-card')].map(c => c.dataset.group);
            state.groups = newOrder;
            markDirty(true);
        });
    });
}

// ─── Drag & Drop — Channels ───────────────────────────────────────────────────
function initChannelDrag(list) {
    let dragSrc = null;

    list.addEventListener('dragstart', e => {
        const item = e.target.closest('.channel-item');
        if (!item) return;
        dragSrc = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.id);
    });

    list.addEventListener('dragend', e => {
        const item = e.target.closest('.channel-item');
        if (item) item.classList.remove('dragging');
        list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        dragSrc = null;
    });

    list.addEventListener('dragover', e => {
        if (!dragSrc) return;
        e.preventDefault();
        const target = e.target.closest('.channel-item');
        if (!target || target === dragSrc) return;

        list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        const rect = target.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
            target.classList.add('drag-over-top');
        } else {
            target.classList.add('drag-over-bottom');
        }
    });

    list.addEventListener('dragleave', e => {
        const target = e.target.closest('.channel-item');
        if (target) {
            target.classList.remove('drag-over-top', 'drag-over-bottom');
        }
    });

    list.addEventListener('drop', e => {
        e.preventDefault();
        if (!dragSrc) return;

        const target = e.target.closest('.channel-item');
        if (!target || target === dragSrc) return;

        target.classList.remove('drag-over-top', 'drag-over-bottom');

        const rect = target.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;

        // Move dragSrc in DOM
        if (e.clientY < mid) {
            list.insertBefore(dragSrc, target);
        } else {
            target.after(dragSrc);
        }

        // Update state.channels order for this group
        syncChannelOrderFromDOM();
        markDirty(true);
    });
}

function syncChannelOrderFromDOM() {
    // Rebuild channel list from DOM order
    const newChannels = [];
    const groupCards = groupsContainer.querySelectorAll('.group-card');
    groupCards.forEach(card => {
        const groupName = card.dataset.group;
        card.querySelectorAll('.channel-item').forEach((item, idx) => {
            const ch = state.channels.find(c => c.id === item.dataset.id);
            if (ch) newChannels.push({ ...ch, group: groupName, order: idx });
        });
    });
    state.channels = newChannels;
}

// ─── Dirty state ─────────────────────────────────────────────────────────────
function markDirty(dirty) {
    state.dirty = dirty;
    saveBtn.disabled = !dirty;
}

// ─── Save ─────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
    syncChannelOrderFromDOM();
    try {
        saveBtn.disabled = true;
        await api('POST', '/save', { channels: state.channels, groups: state.groups });
        showToast('Order saved!', 'success');
        markDirty(false);
    } catch (err) {
        showToast('Save failed: ' + err.message, 'error');
        saveBtn.disabled = false;
    }
});

// ─── Search ──────────────────────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    document.querySelectorAll('.channel-item').forEach(item => {
        const name = item.querySelector('.channel-name').textContent.toLowerCase();
        item.classList.toggle('hidden-by-search', !!q && !name.includes(q));
    });

    // Update count
    const total = state.channels.length;
    if (q) {
        const visible = document.querySelectorAll('.channel-item:not(.hidden-by-search)').length;
        channelCount.textContent = `${total} channels · ${state.groups.length} groups · ${visible} matching`;
    } else {
        channelCount.textContent = `${total} channels · ${state.groups.length} groups`;
    }
});

// ─── Copy URL ────────────────────────────────────────────────────────────────
copyUrlBtn.addEventListener('click', () => {
    const url = playlistUrlText.textContent;
    if (url && url !== 'Loading...') {
        navigator.clipboard.writeText(url).then(() => showToast('URL copied!', 'success'));
    }
});

// ─── Fetch source ─────────────────────────────────────────────────────────────
fetchSourceBtn.addEventListener('click', async () => {
    const url = sourceUrlInput.value.trim();
    if (!url) { showToast('Enter a source URL', 'error'); return; }
    fetchSourceBtn.disabled = true;
    fetchSourceBtn.innerHTML = '<span class="spinner"></span>Fetching...';
    try {
        const data = await api('POST', '/source', { sourceUrl: url });
        applyState(data);
        showToast(`Imported ${data.channels.length} channels`, 'success');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        fetchSourceBtn.disabled = false;
        fetchSourceBtn.textContent = 'Fetch & Set Source';
    }
});

// ─── Import paste ─────────────────────────────────────────────────────────────
importPasteBtn.addEventListener('click', async () => {
    const text = m3uPasteArea.value.trim();
    if (!text) { showToast('Paste an M3U list first', 'error'); return; }
    importPasteBtn.disabled = true;
    importPasteBtn.innerHTML = '<span class="spinner"></span>Importing...';
    try {
        const data = await api('POST', '/import', { text });
        applyState(data);
        m3uPasteArea.value = '';
        showToast(`Imported ${data.channels.length} channels`, 'success');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        importPasteBtn.disabled = false;
        importPasteBtn.textContent = 'Import Pasted M3U';
    }
});

// ─── Sync now ─────────────────────────────────────────────────────────────────
syncNowBtn.addEventListener('click', async () => {
    syncNowBtn.disabled = true;
    syncNowBtn.innerHTML = '<span class="spinner"></span>Syncing...';
    try {
        const data = await api('POST', '/sync', {});
        applyState(data);
        showToast('Sync complete!', 'success');
    } catch (err) {
        showToast('Sync failed: ' + err.message, 'error');
    } finally {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync Now';
    }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadPlaylist().catch(err => showToast('Load failed: ' + err.message, 'error'));
