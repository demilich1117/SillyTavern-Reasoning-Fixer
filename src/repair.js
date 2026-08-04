const ENVELOPE_TAGS = ['think', 'thinking', 'reasoning', 'analysis'];

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimText(value) {
    return String(value ?? '').trim();
}

function cloneValue(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function appendVisibleContent(existing, moved) {
    const first = trimText(existing);
    const second = trimText(moved);
    if (!first) return second;
    if (!second) return first;
    return `${first}\n\n${second}`;
}

/**
 * Extracts a conventional reasoning envelope when the core parser did not.
 * This intentionally only accepts an envelope at the beginning of the message.
 * @param {string} text
 * @returns {{reasoning:string, content:string}|null}
 */
export function extractReasoningEnvelope(text) {
    const names = ENVELOPE_TAGS.map(escapeRegExp).join('|');
    const regex = new RegExp(
        `^\\s*<\\s*(${names})\\s*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>([\\s\\S]*)$`,
        'i',
    );
    const match = String(text ?? '').match(regex);
    if (!match) return null;

    const opening = String(text).match(new RegExp(`^\\s*<\\s*(${names})\\s*>`, 'i'));
    if (!opening) return null;
    const openingEnd = opening[0].length;
    const closing = new RegExp(`<\\s*\\/\\s*${escapeRegExp(opening[1])}\\s*>`, 'i');
    const closingMatch = String(text).slice(openingEnd).match(closing);
    if (!closingMatch) return null;
    const closingStart = openingEnd + closingMatch.index;
    const closingEnd = closingStart + closingMatch[0].length;

    return {
        reasoning: trimText(String(text).slice(openingEnd, closingStart)),
        content: trimText(String(text).slice(closingEnd)),
    };
}

function getTagTokenRegex(profile) {
    const tags = Array.isArray(profile?.tags) ? profile.tags : [];
    const names = tags
        .map((tag) => String(tag?.name ?? '').trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp);
    if (!names.length) return null;

    const flags = profile.caseSensitive === true ? 'g' : 'gi';
    return new RegExp(`<\\s*(\\/?)\\s*(${names.join('|')})(?:\\s+[^<>]*?)?\\s*(\\/?)\\s*>`, flags);
}

function getTagConfig(profile, name) {
    const tags = Array.isArray(profile?.tags) ? profile.tags : [];
    const normalized = profile.caseSensitive === true ? name : name.toLowerCase();
    return tags.find((tag) => {
        const candidate = String(tag?.name ?? '').trim();
        return (profile.caseSensitive === true ? candidate : candidate.toLowerCase()) === normalized;
    }) || { name, preserve: true };
}

/**
 * Finds complete configured tag blocks and removes them from the source.
 * Unclosed blocks are intentionally left untouched for safety.
 * @param {string} source
 * @param {object} profile
 * @returns {{remaining:string, blocks:Array}}
 */
export function extractConfiguredBlocks(source, profile) {
    const input = String(source ?? '');
    const tokenRegex = getTagTokenRegex(profile);
    if (!tokenRegex) return { remaining: input, blocks: [] };

    const stack = [];
    const pairs = [];
    let match;
    while ((match = tokenRegex.exec(input)) !== null) {
        const isClosing = match[1] === '/';
        const name = match[2];
        const isSelfClosing = match[3] === '/';
        if (isSelfClosing) continue;

        const comparable = profile.caseSensitive === true ? name : name.toLowerCase();
        if (!isClosing) {
            stack.push({
                name: comparable,
                start: match.index,
                contentStart: match.index + match[0].length,
                config: getTagConfig(profile, name),
            });
            continue;
        }

        let openIndex = -1;
        for (let index = stack.length - 1; index >= 0; index--) {
            if (stack[index].name === comparable) {
                openIndex = index;
                break;
            }
        }
        if (openIndex < 0) continue;

        const opening = stack[openIndex];
        const nested = stack.slice(openIndex + 1);
        if (profile.allowNested === true && nested.length > 0) {
            stack.splice(openIndex);
            pairs.push({
                start: opening.start,
                end: match.index + match[0].length,
                innerStart: opening.contentStart,
                innerEnd: match.index,
                config: opening.config,
            });
            continue;
        }

        stack.splice(openIndex, 1);
        pairs.push({
            start: opening.start,
            end: match.index + match[0].length,
            innerStart: opening.contentStart,
            innerEnd: match.index,
            config: opening.config,
        });
    }

    if (!pairs.length) return { remaining: input, blocks: [] };

    pairs.sort((a, b) => a.start - b.start || b.end - a.end);
    const selected = [];
    for (const pair of pairs) {
        const previous = selected[selected.length - 1];
        if (previous && pair.start < previous.end) continue;
        selected.push(pair);
    }

    let cursor = 0;
    let remaining = '';
    const blocks = [];
    for (const pair of selected) {
        remaining += input.slice(cursor, pair.start);
        const preserveTag = profile.preserveTags !== false && pair.config.preserve !== false;
        const value = preserveTag
            ? input.slice(pair.start, pair.end)
            : input.slice(pair.innerStart, pair.innerEnd);
        blocks.push({
            value,
            tag: String(pair.config.name),
            start: pair.start,
            end: pair.end,
        });
        cursor = pair.end;
    }
    remaining += input.slice(cursor);

    return {
        remaining: trimText(remaining),
        blocks,
    };
}

/**
 * Moves everything from the first configured opening tag to the end.
 * This mode intentionally does not parse the suffix, so nested or unknown
 * tags such as MVU's Analystic and JsonPatch blocks remain intact.
 * @param {string} source
 * @param {object} profile
 * @returns {{remaining:string, blocks:Array}}
 */
export function extractFromFirstConfiguredTag(source, profile) {
    const input = String(source ?? '');
    const tokenRegex = getTagTokenRegex(profile);
    if (!tokenRegex) return { remaining: input, blocks: [] };

    let match;
    while ((match = tokenRegex.exec(input)) !== null) {
        const isClosing = match[1] === '/';
        if (isClosing) continue;

        const config = getTagConfig(profile, match[2]);
        return {
            remaining: trimText(input.slice(0, match.index)),
            blocks: [{
                value: input.slice(match.index),
                tag: String(config.name),
                start: match.index,
                end: input.length,
            }],
        };
    }

    return { remaining: input, blocks: [] };
}

function clearReasoningMetadata(extra) {
    delete extra.reasoning;
    delete extra.reasoning_type;
    delete extra.reasoning_duration;
    delete extra.reasoning_signature;
    delete extra.reasoning_display_text;
}

function ensureExtra(message) {
    if (!message.extra || typeof message.extra !== 'object') {
        message.extra = {};
    }
    return message.extra;
}

function repairSingleText(message, profile) {
    const extra = ensureExtra(message);
    const originalMes = String(message.mes ?? '');
    const originalReasoning = String(extra.reasoning ?? '');
    const originalDisplayText = typeof extra.display_text === 'string' ? extra.display_text : null;
    let content = originalMes;
    let reasoning = originalReasoning;
    let changed = false;
    const movedBlocks = [];

    if (!trimText(reasoning)) {
        const envelope = extractReasoningEnvelope(content);
        if (envelope) {
            reasoning = envelope.reasoning;
            content = envelope.content;
            changed = true;
        }
    }

    const extracted = extractFromFirstConfiguredTag(reasoning, profile);
    if (extracted.blocks.length > 0) {
        movedBlocks.push(...extracted.blocks);
        reasoning = extracted.remaining;
        const contentTrimmed = trimText(content);
        const blocksToAppend = extracted.blocks
            .map((block) => block.value)
            .filter((value) => !contentTrimmed.includes(trimText(value)));
        content = appendVisibleContent(content, blocksToAppend.join('\n\n'));
        changed = true;
    }

    if (!changed) {
        return { changed: false, movedBlocks: [] };
    }

    message.mes = content;
    if (originalDisplayText !== null && trimText(originalDisplayText) === trimText(originalMes)) {
        extra.display_text = content;
    }
    if (trimText(reasoning)) {
        extra.reasoning = reasoning;
    } else {
        clearReasoningMetadata(extra);
    }

    return { changed: true, movedBlocks };
}

function repairSwipes(message, profile) {
    if (!Array.isArray(message.swipes) || message.swipes.length === 0) {
        return { changed: false, movedBlocks: [] };
    }

    if (!Array.isArray(message.swipe_info)) {
        message.swipe_info = [];
    }

    let changed = false;
    const movedBlocks = [];
    for (let index = 0; index < message.swipes.length; index++) {
        const info = message.swipe_info[index] || { extra: {} };
        info.extra = info.extra && typeof info.extra === 'object' ? info.extra : {};
        const swipeMessage = { mes: message.swipes[index], extra: info.extra };
        const result = repairSingleText(swipeMessage, profile);
        if (result.changed) {
            message.swipes[index] = swipeMessage.mes;
            info.extra = swipeMessage.extra;
            message.swipe_info[index] = info;
            changed = true;
            movedBlocks.push(...result.movedBlocks);
        }
    }

    return { changed, movedBlocks };
}

/**
 * Repairs a chat message in place.
 * @param {object} message
 * @param {object} profile
 * @returns {{changed:boolean,movedBlocks:Array}}
 */
export function repairMessage(message, profile) {
    if (!message || message.is_user === true) {
        return { changed: false, movedBlocks: [] };
    }

    const result = repairSingleText(message, profile);
    const swipeResult = repairSwipes(message, profile);
    const changed = result.changed || swipeResult.changed;
    const movedBlocks = [...result.movedBlocks, ...swipeResult.movedBlocks];

    if (changed && Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) {
        const selected = message.swipe_id;
        if (selected >= 0 && selected < message.swipes.length) {
            message.swipes[selected] = message.mes;
            message.swipe_info[selected] = message.swipe_info[selected] || {};
            message.swipe_info[selected].extra = cloneValue(message.extra || {});
        }
    }

    return { changed, movedBlocks };
}

export function repairChat(chat, profile) {
    if (!Array.isArray(chat)) return { changed: false, count: 0, movedBlocks: [] };

    let changed = false;
    let count = 0;
    const movedBlocks = [];
    for (const message of chat) {
        const result = repairMessage(message, profile);
        if (result.changed) {
            changed = true;
            count++;
            movedBlocks.push(...result.movedBlocks);
        }
    }
    return { changed, count, movedBlocks };
}
