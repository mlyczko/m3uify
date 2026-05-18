// ─── State ───────────────────────────────────────────────────────────────────
let state = {
    channels: [],
    groups: [],
    disabledGroups: [],
    customGroups: [],
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
    let totalVisible = 0;

    for (const [groupName, channels] of channelsByGroup) {
        const card = renderGroup(groupName, channels, search);
        groupsContainer.appendChild(card);
        // Render a mirror card in pane B
        const cardB = renderGroup(groupName, channels, search);
        groupsContainerB.appendChild(cardB);
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

    for (const ch of channels) {
        const item = renderChannel(ch, search);
        list.appendChild(item);
    }

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
        moveChannelInState(channelDragSrc.dataset.id, groupName, null, 'append');
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

function renderChannel(ch, search) {
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
    ${logoEl}
    <span class="channel-name">${escapeHtml(ch.name)}</span>
    <button class="channel-move-btn" title="Move to group">↪</button>
    <button class="channel-toggle-btn ${ch.disabled ? 'off' : 'on'}" title="${ch.disabled ? 'Enable channel' : 'Disable channel'}">●</button>
    <span class="channel-drag-handle">⠿</span>
  `;

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

function initGroupDrag() {
    // Run drag init on both panes; each pane is self-contained for group reordering
    [groupsContainer, groupsContainerB].forEach(container => {
        const cards = container.querySelectorAll('.group-card');
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

                const allCards = [...container.querySelectorAll('.group-card')];
                const srcIdx = allCards.indexOf(dragSrc);
                const dstIdx = allCards.indexOf(card);

                if (srcIdx < dstIdx) {
                    card.after(dragSrc);
                } else {
                    card.before(dragSrc);
                }

                // Update state.groups order from this pane
                const newOrder = [...container.querySelectorAll('.group-card')].map(c => c.dataset.group);
                state.groups = newOrder;
                // Mirror the new order in the other pane
                const otherContainer = container === groupsContainer ? groupsContainerB : groupsContainer;
                newOrder.forEach(groupName => {
                    const mirror = [...otherContainer.querySelectorAll('.group-card')].find(c => c.dataset.group === groupName);
                    if (mirror) otherContainer.appendChild(mirror);
                });
                markDirty(true);
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
        if (target && target !== channelDragSrc) {
            target.classList.remove('drag-over-top', 'drag-over-bottom');
            const rect = target.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            const position = e.clientY < mid ? 'before' : 'after';
            moveChannelInState(channelDragSrc.dataset.id, targetGroup, target.dataset.id, position);
        } else {
            moveChannelInState(channelDragSrc.dataset.id, targetGroup, null, 'append');
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
            for (const ch of channels) list.appendChild(renderChannel(ch, search));
        });
    });
    const q = searchInput.value.trim().toLowerCase();
    channelCount.textContent = `${state.channels.length} channels · ${state.groups.length} groups`;
    if (q) {
        const visible = state.channels.filter(ch => ch.name.toLowerCase().includes(q)).length;
        channelCount.textContent += ` · ${visible} matching`;
    }
}

function rerenderOtherPaneLists(activeContainer) {
    rerenderAllLists();
}

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
searchInput.addEventListener('input', () => {
    searchClear.style.display = searchInput.value ? 'block' : 'none';
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
        playlistUrlText.textContent = data.url;
        showToast('New token generated!', 'success');
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
    cronSaveBtn.disabled = true;
    try {
        await api('POST', '/cron', { expression: expr });
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

