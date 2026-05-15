/**
 * M3U parser utilities
 */

/**
 * Parse raw M3U text into an array of channel objects.
 * @param {string} text - Raw M3U playlist text
 * @returns {Array} Array of channel objects
 */
function parseM3U(text) {
    const lines = text.split(/\r?\n/);
    const channels = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('#EXTINF:')) {
            const channel = parseExtInf(line);
            // Look ahead: collect #EXTGRP and URL from following lines
            let urlLine = '';
            for (let j = i + 1; j < lines.length; j++) {
                const next = lines[j].trim();
                if (!next) continue;
                if (next.startsWith('#EXTGRP:')) {
                    // Override group from #EXTGRP if group-title wasn't set in #EXTINF
                    const extgrp = next.slice(8).trim();
                    if (extgrp && channel.group === 'Ungrouped') {
                        channel.group = extgrp;
                    }
                    continue;
                }
                if (next.startsWith('#')) continue; // skip other # directives
                urlLine = next;
                i = j; // skip to url line
                break;
            }
            if (urlLine) {
                channel.url = urlLine;
                channels.push(channel);
            }
        }
    }

    return channels;
}

function parseExtInf(line) {
    // #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Channel Name
    const channel = {
        id: null,
        name: '',
        group: 'Ungrouped',
        logo: '',
        tvgId: '',
        tvgName: '',
        extraAttrs: '',
        url: '',
        order: 0,
    };

    // Extract attributes
    const attrMatch = line.match(/^#EXTINF:[^,]*/);
    if (attrMatch) {
        const attrStr = attrMatch[0];

        const tvgId = attrStr.match(/tvg-id="([^"]*)"/);
        if (tvgId) channel.tvgId = tvgId[1];

        const tvgName = attrStr.match(/tvg-name="([^"]*)"/);
        if (tvgName) channel.tvgName = tvgName[1];

        const logo = attrStr.match(/tvg-logo="([^"]*)"/);
        if (logo) channel.logo = logo[1];

        const group = attrStr.match(/group-title="([^"]*)"/);
        if (group && group[1]) channel.group = group[1];

        // Preserve any extra unknown attributes (e.g. timeshift, catchup)
        const known = /tvg-id="[^"]*"|tvg-name="[^"]*"|tvg-logo="[^"]*"|group-title="[^"]*"|#EXTINF:[\d-]+\s*/g;
        const extra = attrStr.replace(known, '').trim();
        if (extra) channel.extraAttrs = extra;
    }

    // Extract channel name (after the last comma)
    const commaIdx = line.lastIndexOf(',');
    if (commaIdx !== -1) {
        channel.name = line.substring(commaIdx + 1).trim();
    }

    return channel;
}

/**
 * Serialize channels array back to M3U format
 * @param {Array} channels
 * @returns {string}
 */
function serializeM3U(channels) {
    let out = '#EXTM3U\n';
    for (const ch of channels) {
        const extra = ch.extraAttrs ? ` ${ch.extraAttrs}` : '';
        out += `#EXTINF:-1 tvg-id="${ch.tvgId}" tvg-name="${ch.tvgName}" tvg-logo="${ch.logo}" group-title="${ch.group}"${extra},${ch.name}\n`;
        out += `${ch.url}\n`;
    }
    return out;
}

module.exports = { parseM3U, serializeM3U };
