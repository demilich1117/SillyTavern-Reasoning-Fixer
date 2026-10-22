import { codeRanges, isEscaped, rangeAt, splitLeadingReasoning } from './syntax.js';

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
    const parsed = splitLeadingReasoning(text);
    return parsed?.complete ? { reasoning: trimText(parsed.reasoning), content: trimText(parsed.content) } : null;
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

function isLikelyTagSequenceMention(input, match) {
    const lineStart = input.lastIndexOf('\n', match.index - 1) + 1;
    const nextLineBreak = input.indexOf('\n', match.index + match[0].length);
    const lineEnd = nextLineBreak < 0 ? input.length : nextLineBreak;
    const line = input.slice(lineStart, lineEnd);
    const matchOffset = match.index - lineStart;
    const before = line.slice(0, matchOffset);
    const after = line.slice(matchOffset + match[0].length);
    const arrow = /(?:-{1,2}>|→)/;

    // Models commonly describe their planned output as either a per-line list
    // ("-> <content>") or an inline chain ("<header> -> <content>").
    // Those tags are references to the schema, not final-output boundaries.
    if (/^(?:-{1,2}>|→)/.test(after.trimStart()) || /(?:-{1,2}>|→)\s*$/.test(before)) {
        return true;
    }

    const tagTokens = line.match(/<\s*(?!\/)\s*[A-Za-z][^<>]*>/g) || [];
    return arrow.test(line) && tagTokens.length > 1;
}

function containsConfiguredOpeningTag(source, profile, expectedName) {
    const tokenRegex = getTagTokenRegex(profile);
    if (!tokenRegex) return false;

    const comparableExpected = profile.caseSensitive === true
        ? String(expectedName)
        : String(expectedName).toLowerCase();
    let match;
    const ranges = codeRanges(source);
    while ((match = tokenRegex.exec(String(source ?? ''))) !== null) {
        if (isEscaped(source, match.index) || rangeAt(ranges, match.index)) continue;
        const isClosing = match[1] === '/';
        const isSelfClosing = match[3] === '/';
        const comparable = profile.caseSensitive === true ? match[2] : match[2].toLowerCase();
        if (!isClosing && !isSelfClosing && comparable === comparableExpected) {
            return true;
        }
    }
    return false;
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
 * Moves everything from the first viable configured opening tag to the end.
 * If that same start tag appears more than once, earlier occurrences are
 * treated as draft mentions and the last occurrence becomes the boundary.
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

    let candidate = null;
    let candidateName = null;
    const ranges = codeRanges(input);
    let match;
    while ((match = tokenRegex.exec(input)) !== null) {
        const isClosing = match[1] === '/';
        const isSelfClosing = match[3] === '/';
        if (isSelfClosing) continue;
        if (isEscaped(input, match.index)) continue;
        const range = rangeAt(ranges, match.index);
        const fencedOutput = range?.kind === 'fence' && range.closed && profile.fencedOutput === 'unwrap'
            && !input.slice(range.end).trim() && !input.slice(range.contentStart, match.index).trim();
        if (range && !fencedOutput) continue;

        if (!isClosing && isLikelyTagSequenceMention(input, match)) {
            continue;
        }

        const comparable = profile.caseSensitive === true ? match[2] : match[2].toLowerCase();
        if (!candidate) {
            if (isClosing) continue;
            candidate = {
                match,
                config: getTagConfig(profile, match[2]),
                fence: fencedOutput ? range : null,
            };
            candidateName = comparable;
            continue;
        }

        if (comparable !== candidateName) continue;

        if (isClosing) continue;

        // Start tags are expected to be unique in the final output. If the same
        // one occurs again, the earlier occurrence was likely part of a draft.
        candidate = {
            match,
            config: getTagConfig(profile, match[2]),
            fence: fencedOutput ? range : null,
        };
    }

    if (!candidate) return { remaining: input, blocks: [] };

    const start = candidate.fence?.start ?? candidate.match.index;
    const end = candidate.fence?.contentEnd ?? input.length;
    let value = input.slice(candidate.match.index, end);
    if (profile.preserveTags === false || candidate.config.preserve === false) {
        value = value.slice(candidate.match[0].length);
        // Strip only this outer pair, preserving nested and unrelated output tags.
        const pairRegex = new RegExp(`<\\s*(\\/?)\\s*${escapeRegExp(candidate.match[2])}(?:\\s+[^<>]*?)?\\s*>`, profile.caseSensitive ? 'g' : 'gi');
        let depth = 1;
        for (const token of value.matchAll(pairRegex)) {
            depth += token[1] ? -1 : 1;
            if (depth === 0) { value = value.slice(0, token.index) + value.slice(token.index + token[0].length); break; }
        }
    }
    return {
        remaining: trimText(input.slice(0, start)),
        blocks: [{
            value,
            tag: String(candidate.config.name),
            start,
            end: candidate.fence?.end ?? input.length,
        }],
    };
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
    const contentTrimmed = trimText(content);
    const extractedTagAlreadyVisible = extracted.blocks.length > 0
        && containsConfiguredOpeningTag(content, profile, extracted.blocks[0].tag);
    const extractedBlockAlreadyVisible = extracted.blocks.length > 0
        && extracted.blocks.every((block) => contentTrimmed.includes(trimText(block.value)));
    const visibleTagHasDifferentContent = extractedTagAlreadyVisible && !extractedBlockAlreadyVisible;
    if (extracted.blocks.length > 0 && !visibleTagHasDifferentContent) {
        movedBlocks.push(...extracted.blocks);
        reasoning = extracted.remaining;
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
    if (content !== originalMes && originalDisplayText !== null) {
        if (trimText(originalDisplayText) === trimText(originalMes)) extra.display_text = content;
        else delete extra.display_text;
    }
    if (reasoning !== originalReasoning) {
        delete extra.reasoning_signature;
        if (typeof extra.reasoning_display_text === 'string') {
            if (trimText(extra.reasoning_display_text) === trimText(originalReasoning)) extra.reasoning_display_text = reasoning;
            else delete extra.reasoning_display_text;
        }
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
        // TT can keep inactive swipes cold. Never turn null into empty content.
        if (typeof message.swipes[index] !== 'string') continue;
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
    if (!message || message.is_user === true || message.is_system === true || message.role === 'tool') {
        return { changed: false, movedBlocks: [] };
    }

    const result = repairSingleText(message, profile);
    const swipeResult = repairSwipes(message, profile);
    const changed = result.changed || swipeResult.changed;
    const movedBlocks = [...result.movedBlocks, ...swipeResult.movedBlocks];

    if (result.changed && Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) {
        const selected = message.swipe_id;
        if (selected >= 0 && selected < message.swipes.length) {
            message.swipes[selected] = message.mes;
            message.swipe_info[selected] = message.swipe_info[selected] || {};
            const selectedExtra = message.swipe_info[selected].extra ||= {};
            for (const key of ['reasoning', 'reasoning_type', 'reasoning_duration', 'reasoning_signature', 'reasoning_display_text', 'display_text']) {
                if (Object.hasOwn(message.extra, key)) selectedExtra[key] = cloneValue(message.extra[key]);
                else delete selectedExtra[key];
            }
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
