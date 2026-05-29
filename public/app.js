// ─── State ───────────────────────────────────────────────────────────────────
let state = {
    channels: [],
    groups: [],
    disabledGroups: [],
    customGroups: [],
    epgUrls: [],
    token: null,
    sourceUrl: null,
    lastSync: null,
    dirty: false,
};

// ─── DOM refs ────────────────────────────────────────────────────────────────
const groupsContainer = document.getElementById('groups-container');
const groupsContainerB = document.getElementById('groups-container-b');
const dualPane = document.getElementById('dual-pane');
const emptyState = document.getElementById('empty-state');
const paneAToolbar = document.getElementById('pane-a-toolbar');
const paneBToolbar = document.getElementById('pane-b-toolbar');
const saveBtn = document.getElementById('save-btn');
const searchInput = document.getElementById('search-input');
const channelCount = document.getElementById('channel-count');
const playlistUrlText = document.getElementById('playlist-url-text');
const copyUrlBtn = document.getElementById('copy-url-btn');
const sourceUrlInput = document.getElementById('source-url-input');
const fetchSourceBtn = document.getElementById('fetch-source-btn');
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
    if (res.status === 401) { window.location.href = '/login'; throw new Error('Session expired'); }
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
    state.disabledGroups = data.disabledGroups || [];
    state.customGroups = data.customGroups || [];
    state.epgUrls = data.epgUrls || [];
    state.token = data.token;
    state.sourceUrl = data.sourceUrl || null;
    state.lastSync = data.lastSync || null;
    state.dirty = false;

    if (data.version) {
        document.getElementById('app-version').textContent = 'v' + data.version;
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.style.display = data.authEnabled ? '' : 'none';

    // Security section visibility
    const secSection = document.getElementById('security-section');
    const secEnvNote = document.getElementById('security-env-note');
    const secForm = document.getElementById('security-form');
    const secCurrentWrap = document.getElementById('security-current-pw-wrap');
    const secRemove = document.getElementById('security-remove-btn');
    const secSave = document.getElementById('security-save-btn');
    if (secSection) {
        secSection.style.display = '';
        if (data.managedByEnv) {
            secEnvNote.style.display = '';
            secForm.style.display = 'none';
        } else {
            secEnvNote.style.display = 'none';
            secForm.style.display = '';
            secCurrentWrap.style.display = data.authEnabled ? '' : 'none';
            secRemove.style.display = data.authEnabled ? '' : 'none';
            secSave.textContent = data.authEnabled ? 'Change Password' : 'Set Password';
        }
    }

    if (state.token) {
        const url = `${location.origin}/${state.token}`;
        playlistUrlText.textContent = url;
    }

    if (state.sourceUrl) sourceUrlInput.value = state.sourceUrl;
    renderEpgList();
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

// ─── EPG Sources ─────────────────────────────────────────────────────────────
function renderEpgList() {
    const list = document.getElementById('epg-url-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.epgUrls.length) {
        list.innerHTML = '<div class="epg-empty">No EPG sources added yet.</div>';
        return;
    }
    for (const url of state.epgUrls) {
        const row = document.createElement('div');
        row.className = 'epg-url-row';
        row.innerHTML = `<span class="epg-url-text" title="${escapeHtml(url)}">${escapeHtml(url)}</span><button class="epg-remove-btn btn-danger btn-sm" title="Remove EPG">✕</button>`;
        row.querySelector('.epg-remove-btn').addEventListener('click', async () => {
            try {
                const data = await api('DELETE', '/epg', { url });
                state.epgUrls = data.epgUrls;
                renderEpgList();
                showToast('EPG removed', 'success');
            } catch (err) {
                showToast('Failed: ' + err.message, 'error');
            }
        });
        list.appendChild(row);
    }
}

document.getElementById('epg-add-btn').addEventListener('click', async () => {
    const input = document.getElementById('epg-url-input');
    const url = input.value.trim();
    if (!url) { showToast('Enter an EPG URL', 'error'); return; }
    try {
        const data = await api('POST', '/epg', { url });
        state.epgUrls = data.epgUrls;
        input.value = '';
        renderEpgList();
        showToast('EPG source added', 'success');
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    }
});

document.getElementById('epg-url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('epg-add-btn').click();
});

// ─── Render ──────────────────────────────────────────────────────────────────
function renderAll() {
    selectedIds.clear();
    lastSelectedId = null;
    groupsContainer.innerHTML = '';
    groupsContainerB.innerHTML = '';

    if (!state.channels.length && !state.groups.length) {
        emptyState.classList.remove('hidden');
        paneAToolbar.classList.add('hidden');
        paneBToolbar.classList.add('hidden');
        channelCount.textContent = '';
        return;
    }

    emptyState.classList.add('hidden');
    paneAToolbar.classList.remove('hidden');
    paneBToolbar.classList.remove('hidden');

    // Group channels by group name, maintaining group order
    const channelsByGroup = new Map();
    for (const g of state.groups) channelsByGroup.set(g, []);
    for (const ch of state.channels) {
        if (!channelsByGroup.has(ch.group)) channelsByGroup.set(ch.group, []);
        channelsByGroup.get(ch.group).push(ch);
    }

    const search = searchInput.value.trim().toLowerCase();
    const activeSearch = search.length >= 3 ? search : '';
    let totalVisible = 0;

    for (const [groupName, channels] of channelsByGroup) {
        const card = renderGroup(groupName, channels, activeSearch);
        groupsContainer.appendChild(card);
        const cardB = renderGroup(groupName, channels, activeSearch);
        groupsContainerB.appendChild(cardB);
        const visible = channels.filter(ch => !activeSearch || ch.name.toLowerCase().includes(activeSearch));
        totalVisible += visible.length;
    }

    channelCount.textContent = `${state.channels.length} channels · ${state.groups.length} groups`;
    if (activeSearch) channelCount.textContent += ` · ${totalVisible} matching`;

    initGroupDrag();

    // Re-apply group expansion + left-border highlight if an active search exists
    if (activeSearch) applySearchHighlight(activeSearch);
}

function renderGroup(groupName, channels, search) {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.dataset.group = groupName;

    const isDisabled = state.disabledGroups.includes(groupName);
    if (isDisabled) card.classList.add('group-disabled');
    const isCustom = state.customGroups.includes(groupName);

    const header = document.createElement('div');
    header.className = 'group-header';
    header.draggable = true;
    header.innerHTML = `
    <span class="drag-handle">⠿</span>
    <span class="group-title">${escapeHtml(groupName)}</span>
    <span class="group-count">${channels.length}</span>
    <button class="group-toggle-btn ${isDisabled ? 'off' : 'on'}" title="${isDisabled ? 'Enable group in playlist' : 'Disable group in playlist'}">●</button>
    <button class="group-rename-btn" title="Rename group">✎</button>
    ${isCustom ? `<button class="group-delete-btn" title="Delete group">🗑</button>` : ''}
  `;

    const list = document.createElement('ul');
    list.className = 'channel-list';
    list.dataset.group = groupName;

    channels.forEach((ch, idx) => {
        const item = renderChannel(ch, search, idx + 1);
        list.appendChild(item);
    });

    list.style.display = 'none';

    header.addEventListener('click', (e) => {
        // Don't toggle if clicking rename button, toggle button, delete button, or rename input
        if (e.target.closest('.group-rename-btn, .group-rename-input, .group-toggle-btn, .group-delete-btn')) return;
        const collapsed = list.style.display === 'none';
        list.style.display = collapsed ? '' : 'none';
    });

    const toggleBtn = header.querySelector('.group-toggle-btn');
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = state.disabledGroups.indexOf(groupName);
        if (idx === -1) {
            state.disabledGroups.push(groupName);
            card.classList.add('group-disabled');
            toggleBtn.classList.replace('on', 'off');
            toggleBtn.title = 'Enable group in playlist';
        } else {
            state.disabledGroups.splice(idx, 1);
            card.classList.remove('group-disabled');
            toggleBtn.classList.replace('off', 'on');
            toggleBtn.title = 'Disable group in playlist';
        }
        markDirty(true);
    });

    const renameBtn = header.querySelector('.group-rename-btn');
    renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startGroupRename(card, header, groupName);
    });

    const deleteBtn = header.querySelector('.group-delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteGroup(groupName, card);
        });
    }

    card.appendChild(header);
    card.appendChild(list);

    // Allow dropping channels onto the group header (for collapsed groups)
    header.addEventListener('dragover', e => {
        if (!channelDragSrc) return;
        e.preventDefault();
        e.stopPropagation();
        header.classList.add('group-header-drop-over');
    });
    header.addEventListener('dragleave', () => {
        header.classList.remove('group-header-drop-over');
    });
    header.addEventListener('drop', e => {
        if (!channelDragSrc) return;
        e.preventDefault();
        e.stopPropagation();
        header.classList.remove('group-header-drop-over');
        const srcId = channelDragSrc.dataset.id;
        channelDragSrc = null; // clear before DOM mutation so dragend doesn't need to
        moveChannelInState(srcId, groupName, null, 'append');
        markDirty(true);
    });

    initChannelDrag(list);
    return card;
}

function startGroupRename(card, header, oldName) {
    const titleEl = header.querySelector('.group-title');
    const renameBtn = header.querySelector('.group-rename-btn');

    // Prevent double-invoke
    if (header.querySelector('.group-rename-input')) return;

    // Temporarily disable group drag while editing
    header.draggable = false;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'group-rename-input';
    input.value = oldName;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    async function commit() {
        const newName = input.value.trim();
        header.draggable = true;
        if (!newName || newName === oldName) {
            input.replaceWith(titleEl);
            return;
        }

        // Update state
        state.groups = state.groups.map(g => g === oldName ? newName : g);
        state.channels = state.channels.map(ch => ch.group === oldName ? { ...ch, group: newName } : ch);
        state.disabledGroups = state.disabledGroups.map(g => g === oldName ? newName : g);
        state.customGroups = state.customGroups.map(g => g === oldName ? newName : g);

        // Update card dataset
        card.dataset.group = newName;
        card.querySelector('.channel-list').dataset.group = newName;
        titleEl.textContent = newName;
        input.replaceWith(titleEl);
        renameBtn.disabled = false;

        // Auto-save immediately
        try {
            await api('POST', '/save', { channels: state.channels, groups: state.groups, disabledGroups: state.disabledGroups, customGroups: state.customGroups });
            markDirty(false);
            showToast(`Renamed to "${newName}"`, 'success');
        } catch (err) {
            markDirty(true);
            showToast('Rename saved in UI but failed to persist: ' + err.message, 'error');
        }
    }

    function cancel() {
        header.draggable = true;
        input.replaceWith(titleEl);
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
}

function startChannelRename(li, ch) {
    const nameEl = li.querySelector('.channel-name');
    const renameBtn = li.querySelector('.channel-rename-btn');

    if (li.querySelector('.channel-rename-input')) return;

    // Disable drag while editing
    li.draggable = false;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'channel-rename-input';
    input.value = ch.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    async function commit() {
        const newName = input.value.trim();
        li.draggable = true;
        if (!newName || newName === ch.name) {
            input.replaceWith(nameEl);
            return;
        }

        const idx = state.channels.findIndex(c => c.id === ch.id);
        if (idx !== -1) {
            state.channels[idx] = { ...state.channels[idx], name: newName, customName: newName };
            ch = state.channels[idx];
        }
        nameEl.textContent = newName;
        input.replaceWith(nameEl);

        try {
            await api('POST', '/save', { channels: state.channels, groups: state.groups, disabledGroups: state.disabledGroups, customGroups: state.customGroups });
            markDirty(false);
            showToast(`Renamed to "${newName}"`, 'success');
        } catch (err) {
            markDirty(true);
            showToast('Rename saved in UI but failed to persist: ' + err.message, 'error');
        }
    }

    function cancel() {
        li.draggable = true;
        input.replaceWith(nameEl);
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
}

function renderChannel(ch, search, index) {
    const li = document.createElement('li');
    li.className = 'channel-item';
    li.draggable = true;
    li.dataset.id = ch.id;
    if (ch.disabled) li.classList.add('channel-disabled');

    if (search && !ch.name.toLowerCase().includes(search)) {
        li.classList.add('hidden-by-search');
    }

    const logoEl = ch.logo
        ? `<img class="channel-logo" src="${escapeHtml(ch.logo)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="" /><div class="channel-logo-placeholder" style="display:none">📺</div>`
        : `<div class="channel-logo-placeholder">📺</div>`;

    li.innerHTML = `
    <input type="checkbox" class="channel-checkbox" />
    ${index != null ? `<span class="channel-index">${index}</span>` : ''}
    ${logoEl}
    <span class="channel-name">${escapeHtml(ch.name)}</span>
    <button class="channel-rename-btn" title="Rename channel">✎</button>
    <button class="channel-move-btn" title="Move to group">↪</button>
    <button class="channel-toggle-btn ${ch.disabled ? 'off' : 'on'}" title="${ch.disabled ? 'Enable channel' : 'Disable channel'}">●</button>
    <span class="channel-drag-handle">⠿</span>
  `;

    const checkbox = li.querySelector('.channel-checkbox');
    checkbox.checked = selectedIds.has(ch.id);
    if (selectedIds.has(ch.id)) li.classList.add('ch-selected');
    checkbox.addEventListener('mousedown', e => e.preventDefault()); // prevent drag
    checkbox.addEventListener('click', e => {
        e.stopPropagation();
        const id = ch.id;
        if (e.shiftKey && lastSelectedId) {
            const allItems = [...groupsContainer.querySelectorAll('.channel-item:not(.hidden-by-search)')];
            const ids = allItems.map(el => el.dataset.id);
            const a = ids.indexOf(lastSelectedId);
            const b = ids.indexOf(id);
            if (a !== -1 && b !== -1) {
                const [from, to] = a < b ? [a, b] : [b, a];
                for (let i = from; i <= to; i++) selectedIds.add(ids[i]);
            }
            lastSelectedId = id;
        } else {
            if (selectedIds.has(id)) { selectedIds.delete(id); lastSelectedId = null; }
            else { selectedIds.add(id); lastSelectedId = id; }
        }
        syncSelectionUI();
    });

    li.querySelector('.channel-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = state.channels.findIndex(c => c.id === ch.id);
        if (idx === -1) return;
        state.channels[idx] = { ...state.channels[idx], disabled: !state.channels[idx].disabled };
        ch = state.channels[idx];
        li.classList.toggle('channel-disabled', !!ch.disabled);
        const btn = li.querySelector('.channel-toggle-btn');
        btn.classList.toggle('on', !ch.disabled);
        btn.classList.toggle('off', !!ch.disabled);
        btn.title = ch.disabled ? 'Enable channel' : 'Disable channel';
        markDirty(true);
    });

    const renameChBtn = li.querySelector('.channel-rename-btn');
    renameChBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startChannelRename(li, ch);
    });

    const moveBtn = li.querySelector('.channel-move-btn');
    moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Replace button with inline group select
        const select = document.createElement('select');
        select.className = 'channel-move-select';
        for (const g of state.groups) {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            if (g === ch.group) opt.selected = true;
            select.appendChild(opt);
        }
        moveBtn.replaceWith(select);
        select.focus();

        let committed = false;

        function commit() {
            if (committed) return;
            committed = true;
            const newGroup = select.value;
            if (select.isConnected) select.replaceWith(moveBtn);
            if (newGroup === ch.group) return;
            moveChannelInState(ch.id, newGroup, null, 'append');
            ch = state.channels.find(c => c.id === ch.id) || ch;
            markDirty(true);
        }

        function cancel() {
            if (committed) return;
            committed = true;
            if (select.isConnected) select.replaceWith(moveBtn);
        }

        select.addEventListener('change', commit);
        select.addEventListener('blur', cancel);
        select.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
        });
    });

    return li;
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function deleteGroup(groupName, card) {
    const channelsInGroup = state.channels.filter(ch => ch.group === groupName);
    const msg = channelsInGroup.length
        ? `Delete group "${groupName}"? Its ${channelsInGroup.length} channel(s) will be restored to their original groups.`
        : `Delete empty group "${groupName}"?`;
    if (!confirm(msg)) return;

    // Restore channels to their original group (fallback to Ungrouped)
    const groupsToAdd = new Set();
    state.channels = state.channels.map(ch => {
        if (ch.group !== groupName) return ch;
        const target = ch.originalGroup || 'Ungrouped';
        groupsToAdd.add(target);
        return { ...ch, group: target };
    });
    // Ensure any needed groups exist in the list
    for (const g of groupsToAdd) {
        if (!state.groups.includes(g)) state.groups.push(g);
    }
    state.groups = state.groups.filter(g => g !== groupName);
    state.disabledGroups = state.disabledGroups.filter(g => g !== groupName);
    state.customGroups = state.customGroups.filter(g => g !== groupName);

    card.remove();
    renderAll();
    try {
        await api('POST', '/save', { channels: state.channels, groups: state.groups, disabledGroups: state.disabledGroups, customGroups: state.customGroups });
        markDirty(false);
        showToast(`Group "${groupName}" deleted`, 'success');
    } catch (err) {
        markDirty(true);
        showToast(`Deleted in UI but not saved: ${err.message}`, 'error');
    }
}

// ─── Drag & Drop — Groups ────────────────────────────────────────────────────
let channelDragSrc = null; // global so cross-group drag works
const selectedIds = new Set(); // channel IDs selected for bulk actions
let lastSelectedId = null;     // anchor for shift-click range selection
// Fallback: if dragend fires on a detached element it won't bubble — clear here too
document.addEventListener('dragend', () => {
    channelDragSrc = null;
});

// Active group drag state — set on dragstart, cleared on dragend/drop
let _groupDragActive = null; // { container, srcCard }

// Find the nearest group card (excluding the dragged card) to a given clientY.
// Used for both indicator display and drop target resolution.
function findNearestGroupCard(clientY, container, srcCard) {
    const cards = [...container.querySelectorAll('.group-card')].filter(c => c !== srcCard);
    if (!cards.length) return null;
    let best = null, bestDist = Infinity;
    for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) return c;
        const dist = clientY < r.top ? r.top - clientY : clientY - r.bottom;
        if (dist < bestDist) { bestDist = dist; best = c; }
    }
    return best;
}

function clearGroupIndicators(container) {
    container.querySelectorAll('.group-drop-above, .group-drop-below').forEach(c => {
        c.classList.remove('group-drop-above', 'group-drop-below');
    });
}

// Document-level handlers: active whenever a group drag is in progress.
// Using document ensures the drop works even when the cursor briefly leaves the
// container during a fast drag — the container-level drop would miss that.
document.addEventListener('dragover', e => {
    if (!_groupDragActive) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const { container, srcCard } = _groupDragActive;
    clearGroupIndicators(container);
    const overCard = findNearestGroupCard(e.clientY, container, srcCard);
    if (overCard) {
        const rect = overCard.getBoundingClientRect();
        overCard.classList.add(e.clientY < rect.top + rect.height / 2
            ? 'group-drop-above' : 'group-drop-below');
    }
});

document.addEventListener('drop', e => {
    if (!_groupDragActive) return;
    e.preventDefault();
    const { container, srcCard } = _groupDragActive;
    _groupDragActive = null;
    clearGroupIndicators(container);
    const overCard = findNearestGroupCard(e.clientY, container, srcCard);
    if (!overCard) return;
    const rect = overCard.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) overCard.before(srcCard);
    else overCard.after(srcCard);
    const newOrder = [...container.querySelectorAll('.group-card')].map(c => c.dataset.group);
    state.groups = newOrder;
    const otherContainer = container === groupsContainer ? groupsContainerB : groupsContainer;
    newOrder.forEach(groupName => {
        const mirror = [...otherContainer.querySelectorAll('.group-card')].find(c => c.dataset.group === groupName);
        if (mirror) otherContainer.appendChild(mirror);
    });
    markDirty(true);
});

function initGroupDrag() {
    // Only bind per-header dragstart/dragend — drop is handled at document level.
    [groupsContainer, groupsContainerB].forEach(container => {
        container.querySelectorAll('.group-card').forEach(card => {
            const header = card.querySelector('.group-header');

            header.addEventListener('dragstart', e => {
                _groupDragActive = { container, srcCard: card };
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', card.dataset.group);
            });

            header.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                if (_groupDragActive) {
                    clearGroupIndicators(_groupDragActive.container);
                    _groupDragActive = null;
                }
            });
        });
    });
}

// ─── Drag & Drop — Channels ───────────────────────────────────────────────────
function initChannelDrag(list) {

    list.addEventListener('dragstart', e => {
        const item = e.target.closest('.channel-item');
        if (!item) return;
        channelDragSrc = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.id);
    });

    list.addEventListener('dragend', e => {
        const item = e.target.closest('.channel-item');
        if (item) item.classList.remove('dragging');
        document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        document.querySelectorAll('.group-header-drop-over').forEach(el => {
            el.classList.remove('group-header-drop-over');
        });
        channelDragSrc = null;
    });

    list.addEventListener('dragover', e => {
        if (!channelDragSrc) return;
        e.preventDefault();
        const target = e.target.closest('.channel-item');
        if (!target || target === channelDragSrc) return;

        document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
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
        if (!channelDragSrc) return;

        const target = e.target.closest('.channel-item');
        const targetGroup = list.dataset.group;
        const srcId = channelDragSrc.dataset.id;
        const anchorId = (target && target !== channelDragSrc) ? target.dataset.id : null;
        if (target) target.classList.remove('drag-over-top', 'drag-over-bottom');
        channelDragSrc = null; // clear before DOM mutation so dragend fires on detached element harmlessly
        if (anchorId) {
            const rect = target.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            const position = e.clientY < mid ? 'before' : 'after';
            moveChannelInState(srcId, targetGroup, anchorId, position);
        } else {
            moveChannelInState(srcId, targetGroup, null, 'append');
        }
        markDirty(true);
    });
}

function syncChannelOrderFromDOM() { }

function moveChannelInState(srcId, targetGroup, anchorId, position) {
    const srcIdx = state.channels.findIndex(c => c.id === srcId);
    if (srcIdx === -1) return;
    const [moved] = state.channels.splice(srcIdx, 1);
    moved.group = targetGroup;

    if (anchorId) {
        const anchorIdx = state.channels.findIndex(c => c.id === anchorId);
        if (anchorIdx !== -1) {
            state.channels.splice(position === 'before' ? anchorIdx : anchorIdx + 1, 0, moved);
        } else {
            state.channels.push(moved);
        }
    } else {
        const lastInGroup = state.channels.reduce((last, ch, i) => ch.group === targetGroup ? i : last, -1);
        state.channels.splice(lastInGroup + 1, 0, moved);
    }

    const groupCounters = new Map();
    state.channels.forEach(ch => {
        ch.order = groupCounters.get(ch.group) || 0;
        groupCounters.set(ch.group, ch.order + 1);
    });

    rerenderAllLists();
}

function rerenderAllLists() {
    const search = searchInput.value.trim().toLowerCase();
    [groupsContainer, groupsContainerB].forEach(container => {
        container.querySelectorAll('.group-card').forEach(card => {
            const groupName = card.dataset.group;
            const list = card.querySelector('.channel-list');
            const channels = state.channels
                .filter(ch => ch.group === groupName)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            const countEl = card.querySelector('.group-count');
            if (countEl) countEl.textContent = channels.length;
            list.innerHTML = '';
            channels.forEach((ch, idx) => list.appendChild(renderChannel(ch, search, idx + 1)));
        });
    });
    const q = searchInput.value.trim().toLowerCase();
    channelCount.textContent = `${state.channels.length} channels · ${state.groups.length} groups`;
    if (q) {
        const visible = state.channels.filter(ch => ch.name.toLowerCase().includes(q)).length;
        channelCount.textContent += ` · ${visible} matching`;
    }
    syncSelectionUI();
}

function rerenderOtherPaneLists(activeContainer) {
    rerenderAllLists();
}

// ─── Bulk selection ───────────────────────────────────────────────────────────
function syncSelectionUI() {
    [groupsContainer, groupsContainerB].forEach(container => {
        container.querySelectorAll('.channel-item').forEach(li => {
            const sel = selectedIds.has(li.dataset.id);
            li.classList.toggle('ch-selected', sel);
            const cb = li.querySelector('.channel-checkbox');
            if (cb) cb.checked = sel;
        });
    });
    updateBulkToolbar();
}

function updateBulkToolbar() {
    const toolbar = document.getElementById('bulk-toolbar');
    const count = selectedIds.size;
    if (count === 0) { toolbar.classList.add('hidden'); return; }
    toolbar.classList.remove('hidden');
    document.getElementById('bulk-count').textContent =
        `${count} channel${count === 1 ? '' : 's'} selected`;
    const sel = document.getElementById('bulk-move-select');
    sel.innerHTML = '<option value="">Move to group…</option>';
    for (const g of state.groups) {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        sel.appendChild(opt);
    }
}

document.getElementById('bulk-enable-btn').addEventListener('click', () => {
    if (!selectedIds.size) return;
    selectedIds.forEach(id => {
        const idx = state.channels.findIndex(c => c.id === id);
        if (idx !== -1) state.channels[idx] = { ...state.channels[idx], disabled: false };
    });
    const count = selectedIds.size;
    selectedIds.clear(); lastSelectedId = null;
    rerenderAllLists();
    markDirty(true);
    showToast(`Enabled ${count} channel${count === 1 ? '' : 's'}`, 'success');
});

document.getElementById('bulk-disable-btn').addEventListener('click', () => {
    if (!selectedIds.size) return;
    selectedIds.forEach(id => {
        const idx = state.channels.findIndex(c => c.id === id);
        if (idx !== -1) state.channels[idx] = { ...state.channels[idx], disabled: true };
    });
    const count = selectedIds.size;
    selectedIds.clear(); lastSelectedId = null;
    rerenderAllLists();
    markDirty(true);
    showToast(`Disabled ${count} channel${count === 1 ? '' : 's'}`, 'success');
});

document.getElementById('bulk-move-select').addEventListener('change', e => {
    const targetGroup = e.target.value;
    e.target.value = '';
    if (!targetGroup || !selectedIds.size) return;
    const count = selectedIds.size;
    // Batch: update state directly, single re-render
    [...selectedIds].forEach(id => {
        const idx = state.channels.findIndex(c => c.id === id);
        if (idx === -1) return;
        const [moved] = state.channels.splice(idx, 1);
        moved.group = targetGroup;
        state.channels.push(moved);
    });
    // Recalculate order within each group
    const groupCounters = new Map();
    state.channels.forEach(ch => {
        ch.order = groupCounters.get(ch.group) || 0;
        groupCounters.set(ch.group, ch.order + 1);
    });
    if (!state.groups.includes(targetGroup)) state.groups.push(targetGroup);
    selectedIds.clear(); lastSelectedId = null;
    rerenderAllLists();
    markDirty(true);
    showToast(`Moved ${count} channel${count === 1 ? '' : 's'} to “${targetGroup}”`, 'success');
});

document.getElementById('bulk-deselect-btn').addEventListener('click', () => {
    selectedIds.clear(); lastSelectedId = null;
    syncSelectionUI();
});

// ─── Add group ───────────────────────────────────────────────────────────────
document.getElementById('add-group-btn').addEventListener('click', async () => {
    const name = prompt('New group name:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (state.groups.includes(trimmed)) {
        showToast(`Group "${trimmed}" already exists`, 'error');
        return;
    }
    state.groups.push(trimmed);
    state.customGroups.push(trimmed);
    renderAll();
    try {
        await api('POST', '/save', { channels: state.channels, groups: state.groups, disabledGroups: state.disabledGroups, customGroups: state.customGroups });
        markDirty(false);
        showToast(`Group "${trimmed}" created`, 'success');
    } catch (err) {
        markDirty(true);
        showToast(`Group created but not saved: ${err.message}`, 'error');
    }
});

// ─── Dirty state ─────────────────────────────────────────────────────────────
function markDirty(dirty) {
    state.dirty = dirty;
    saveBtn.disabled = !dirty;
}

// ─── Save ─────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
    try {
        saveBtn.disabled = true;
        await api('POST', '/save', { channels: state.channels, groups: state.groups, disabledGroups: state.disabledGroups, customGroups: state.customGroups });
        showToast('Order saved!', 'success');
        markDirty(false);
    } catch (err) {
        showToast('Save failed: ' + err.message, 'error');
        saveBtn.disabled = false;
    }
});

// ─── Search ──────────────────────────────────────────────────────────────────
const searchClear = document.getElementById('search-clear');

function applySearchHighlight(q) {
    // Expand groups with matches and mark them; collapse groups expanded by a prior search that now have no match
    document.querySelectorAll('.group-card').forEach(card => {
        const list = card.querySelector('.channel-list');
        if (!list) return;
        const hasMatch = list.querySelectorAll('.channel-item:not(.hidden-by-search)').length > 0;
        card.classList.toggle('has-search-match', hasMatch);
        if (hasMatch && list.style.display === 'none') {
            list.style.display = '';
            list.dataset.searchExpanded = 'true';
        } else if (!hasMatch && list.dataset.searchExpanded) {
            list.style.display = 'none';
            delete list.dataset.searchExpanded;
        }
    });
}

function clearSearchHighlight() {
    document.querySelectorAll('.group-card').forEach(card => {
        card.classList.remove('has-search-match');
        const list = card.querySelector('.channel-list');
        if (list && list.dataset.searchExpanded) {
            list.style.display = 'none';
            delete list.dataset.searchExpanded;
        }
    });
    document.querySelectorAll('.channel-item').forEach(item => item.classList.remove('hidden-by-search'));
}

searchInput.addEventListener('input', () => {
    const raw = searchInput.value;
    const q = raw.trim().toLowerCase();
    searchClear.style.display = raw ? 'block' : 'none';

    if (q.length === 0) {
        clearSearchHighlight();
        channelCount.textContent = `${state.channels.length} channels · ${state.groups.length} groups`;
        return;
    }

    if (q.length < 3) {
        clearSearchHighlight();
        channelCount.textContent = `Type at least 3 characters to search…`;
        return;
    }

    // q.length >= 3 — filter and highlight
    document.querySelectorAll('.channel-item').forEach(item => {
        const name = item.querySelector('.channel-name').textContent.toLowerCase();
        item.classList.toggle('hidden-by-search', !name.includes(q));
    });
    applySearchHighlight(q);
    const visible = document.querySelectorAll('.channel-item:not(.hidden-by-search)').length;
    channelCount.textContent = `${state.channels.length} channels · ${state.groups.length} groups · ${visible} matching`;
});

searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    searchInput.dispatchEvent(new Event('input'));
    searchInput.focus();
});

// ─── Copy URL ────────────────────────────────────────────────────────────────
copyUrlBtn.addEventListener('click', () => {
    const url = playlistUrlText.textContent;
    if (!url || url === 'Loading...') return;
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => showToast('URL copied!', 'success'));
    } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            document.execCommand('copy');
            showToast('URL copied!', 'success');
        } catch {
            showToast('Copy failed — please copy manually', 'error');
        }
        document.body.removeChild(ta);
    }
});

// ─── Regenerate token ────────────────────────────────────────────────────────
document.getElementById('regen-token-btn').addEventListener('click', async () => {
    if (!confirm('Generate a new token? Your old playlist URL will stop working immediately.')) return;
    try {
        const data = await api('POST', '/token/regenerate', {});
        state.token = data.token;
        playlistUrlText.textContent = `${location.origin}/${data.token}`;
        showToast('New token generated!', 'success');
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    }
});

// ─── Clear playlist ──────────────────────────────────────────────────────────
document.getElementById('clear-playlist-btn').addEventListener('click', async () => {
    if (!confirm('Remove the current playlist and source URL? This cannot be undone.')) return;
    try {
        const data = await api('POST', '/clear', {});
        applyState(data);
        sourceUrlInput.value = '';
        showToast('Playlist cleared', 'success');
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
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
// ─── Reset everything ───────────────────────────────────────────────────────
// ─── Export / Import ────────────────────────────────────────────────────────
document.getElementById('download-m3u-btn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = '/api/download';
    a.download = 'playlist.m3u';
    a.click();
});

document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-input').click();
});

document.getElementById('export-btn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = '/api/backup/export';
    a.download = '';
    a.click();
});

// ─── Import ───────────────────────────────────────────────────────────────────
document.getElementById('import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    let bundle;
    try {
        bundle = JSON.parse(await file.text());
    } catch {
        showToast('Invalid JSON file', 'error');
        return;
    }
    if (!bundle.playlist || !Array.isArray(bundle.playlist.channels)) {
        showToast('Not a valid M3Uify backup file', 'error');
        return;
    }
    const ok = confirm(
        `Import backup from ${bundle.exportedAt ? new Date(bundle.exportedAt).toLocaleString() : 'unknown date'}?\n\n` +
        `This will replace all current settings, channels, and groups.\n\nClick OK to proceed.`
    );
    if (!ok) return;
    try {
        const data = await api('POST', '/backup/import', bundle);
        applyState(data);
        if (data.cronExpression) {
            cronInput.value = data.cronExpression;
            updateCronPreview(data.cronExpression);
            highlightActivePreset(data.cronExpression);
        }
        if (data.cronTimezone && cronTimezoneSelect) cronTimezoneSelect.value = data.cronTimezone;
        showToast('Settings imported successfully!', 'success');
    } catch (err) {
        showToast('Import failed: ' + err.message, 'error');
    }
});

document.getElementById('reset-btn').addEventListener('click', async () => {
    if (!state.sourceUrl) {
        showToast('No source URL configured — nothing to reset to', 'error');
        return;
    }
    const ok = confirm(
        'Reset everything?\n\n' +
        'This will:\n' +
        '  • Re-fetch the original source playlist\n' +
        '  • Restore the original channel and group order\n' +
        '  • Remove all custom groups\n' +
        '  • Re-enable all disabled groups and channels\n' +
        '  • Reset the auto-sync schedule to daily 4AM\n\n' +
        'All your customisations will be lost. This cannot be undone.\n\n' +
        'Click OK to reset.'
    );
    if (!ok) return;
    const btn = document.getElementById('reset-btn');
    btn.disabled = true;
    btn.textContent = 'Resetting...';
    try {
        const data = await api('POST', '/reset', {});
        applyState(data);
        if (data.cronExpression) {
            cronInput.value = data.cronExpression;
            updateCronPreview(data.cronExpression);
            highlightActivePreset(data.cronExpression);
        }
        if (data.cronTimezone && cronTimezoneSelect) cronTimezoneSelect.value = data.cronTimezone;
        showToast('Reset to original playlist!', 'success');
    } catch (err) {
        showToast('Reset failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Reset Everything';
    }
});
// ─── Cron builder ─────────────────────────────────────────────────────────────
const cronInput = document.getElementById('cron-input');
const cronPreview = document.getElementById('cron-preview');
const cronSaveBtn = document.getElementById('cron-save-btn');
const cronPresetBtns = document.querySelectorAll('.cron-preset');
const cronTimezoneSelect = document.getElementById('cron-timezone');

const CRON_DESCRIPTIONS = {
    '0 4 * * *': 'Every day at 04:00',
    '0 */6 * * *': 'Every 6 hours',
    '0 * * * *': 'Every hour',
    '0 4 * * 1': 'Every Monday at 04:00',
    'manual': 'Manual sync only (no auto-sync)',
};

function updateCronPreview(expr) {
    const trimmed = expr.trim();
    const desc = CRON_DESCRIPTIONS[trimmed];
    if (desc) {
        cronPreview.textContent = desc;
        cronPreview.className = 'valid';
    } else {
        const parts = trimmed.split(/\s+/);
        if (parts.length === 5 && parts.every(p => p.length > 0)) {
            cronPreview.textContent = '✓ custom expression';
            cronPreview.className = 'valid';
        } else {
            cronPreview.textContent = 'Need 5 fields: minute hour dom month dow';
            cronPreview.className = 'invalid';
        }
    }
}

function highlightActivePreset(expr) {
    cronPresetBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.expr === expr.trim()));
}

cronInput.addEventListener('input', () => {
    updateCronPreview(cronInput.value);
    highlightActivePreset(cronInput.value);
});

cronPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        cronInput.value = btn.dataset.expr;
        updateCronPreview(btn.dataset.expr);
        highlightActivePreset(btn.dataset.expr);
    });
});

cronSaveBtn.addEventListener('click', async () => {
    const expr = cronInput.value.trim();
    if (!expr) return;
    const timezone = cronTimezoneSelect.value || 'Europe/Warsaw';
    cronSaveBtn.disabled = true;
    try {
        await api('POST', '/cron', { expression: expr, timezone });
        showToast('Schedule saved!', 'success');
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    } finally {
        cronSaveBtn.disabled = false;
    }
});

async function loadCronConfig() {
    try {
        const data = await api('GET', '/cron');
        const expr = data.expression || '0 4 * * *';
        cronInput.value = expr;
        updateCronPreview(expr);
        highlightActivePreset(expr);
        if (data.timezone && cronTimezoneSelect) {
            cronTimezoneSelect.value = data.timezone;
            // If stored timezone isn't in the list, add it dynamically
            if (!cronTimezoneSelect.value) {
                const opt = document.createElement('option');
                opt.value = data.timezone;
                opt.textContent = data.timezone;
                cronTimezoneSelect.appendChild(opt);
                cronTimezoneSelect.value = data.timezone;
            }
        }
    } catch { }
}

// ─── Expand / Collapse all ──────────────────────────────────────────────────
document.getElementById('expand-all-btn').addEventListener('click', () => {
    groupsContainer.querySelectorAll('.channel-list').forEach(list => {
        list.style.display = '';
    });
});

document.getElementById('collapse-all-btn').addEventListener('click', () => {
    groupsContainer.querySelectorAll('.channel-list').forEach(list => {
        list.style.display = 'none';
    });
});

document.getElementById('expand-all-btn-b').addEventListener('click', () => {
    groupsContainerB.querySelectorAll('.channel-list').forEach(list => {
        list.style.display = '';
    });
});

document.getElementById('collapse-all-btn-b').addEventListener('click', () => {
    groupsContainerB.querySelectorAll('.channel-list').forEach(list => {
        list.style.display = 'none';
    });
});

// ─── Layout toggle ──────────────────────────────────────────────────────────
const layoutBtn = document.getElementById('layout-btn');
const TWO_COL_KEY = 'm3uify_two_col';

function applyLayout(twoCol) {
    dualPane.classList.toggle('two-col', twoCol);
    layoutBtn.textContent = twoCol ? '⊞ 2 Columns' : '☰ 1 Column';
    layoutBtn.title = twoCol ? 'Switch to 1 column' : 'Switch to 2 columns — useful for moving channels between groups';
}

// Restore saved preference (default: 1 column)
applyLayout(localStorage.getItem(TWO_COL_KEY) === '1');

layoutBtn.addEventListener('click', () => {
    const twoCol = !dualPane.classList.contains('two-col');
    localStorage.setItem(TWO_COL_KEY, twoCol ? '1' : '0');
    applyLayout(twoCol);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadPlaylist().catch(err => showToast('Load failed: ' + err.message, 'error'));
loadCronConfig();

// ─── Theme toggle ────────────────────────────────────────────────────────────
const themeToggleBtn = document.getElementById('theme-toggle');
const THEME_KEY = 'm3uify_theme';

function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        themeToggleBtn.textContent = '☀︎';
        themeToggleBtn.title = 'Switch to dark mode';
    } else {
        document.documentElement.removeAttribute('data-theme');
        themeToggleBtn.textContent = '🌙';
        themeToggleBtn.title = 'Switch to light mode';
    }
}

// initialise from storage (dark is default)
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

themeToggleBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
});

// ─── Sidebar toggle (mobile) ─────────────────────────────────────────────────
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarEl = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');

function closeSidebar() {
    sidebarEl.classList.remove('open');
    sidebarBackdrop.classList.remove('open');
}

sidebarToggle.addEventListener('click', () => {
    const isOpen = sidebarEl.classList.toggle('open');
    sidebarBackdrop.classList.toggle('open', isOpen);
});
sidebarBackdrop.addEventListener('click', closeSidebar);

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById('logout-btn')?.addEventListener('click', () => {
    window.location.href = '/auth/logout';
});

// ─── Password visibility toggles ─────────────────────────────────────────────
document.querySelectorAll('.pw-eye').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? '🙈' : '👁';
    });
});

// ─── Security / Password management ──────────────────────────────────────────
document.getElementById('security-save-btn')?.addEventListener('click', async () => {
    const currentPw = document.getElementById('security-current-pw').value;
    const newPw = document.getElementById('security-new-pw').value;
    const confirmPw = document.getElementById('security-confirm-pw').value;

    if (!newPw) { showToast('New password cannot be empty', 'error'); return; }
    if (newPw !== confirmPw) { showToast('Passwords do not match', 'error'); return; }

    try {
        const res = await fetch('/api/auth/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Error setting password', 'error'); return; }
        showToast('Password saved', 'success');
        document.getElementById('security-current-pw').value = '';
        document.getElementById('security-new-pw').value = '';
        document.getElementById('security-confirm-pw').value = '';
        // Re-login needed because session is now invalid
        if (data.authEnabled) window.location.href = '/login';
        else await loadPlaylist();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
});

document.getElementById('security-remove-btn')?.addEventListener('click', async () => {
    if (!confirm('Remove password protection? Anyone with the URL can access the dashboard.')) return;
    const currentPw = document.getElementById('security-current-pw').value;
    try {
        const res = await fetch('/api/auth/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: currentPw, newPassword: '' })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Error removing password', 'error'); return; }
        showToast('Password protection removed', 'success');
        document.getElementById('security-current-pw').value = '';
        document.getElementById('security-new-pw').value = '';
        document.getElementById('security-confirm-pw').value = '';
        await loadPlaylist();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
});
