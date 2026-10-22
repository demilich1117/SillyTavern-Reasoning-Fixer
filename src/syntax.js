// Source offsets are retained: parsing must never split a code example in half.
export function isEscaped(text, index) {
    let count = 0;
    while (index > 0 && text[--index] === '\\') count++;
    return count % 2 === 1;
}

export function codeRanges(text) {
    text = String(text ?? '');
    const ranges = [];
    const lines = /[^\n]*(?:\n|$)/g;
    let fence = null;
    let line;
    while ((line = lines.exec(text)) && line[0]) {
        const marker = line[0].match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/);
        if (!marker) continue;
        if (fence) {
            if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) {
                ranges.push({ ...fence, end: lines.lastIndex, contentEnd: line.index, closed: true });
                fence = null;
            }
        } else if (!(marker[1][0] === '`' && marker[2].includes('`'))) {
            fence = { kind: 'fence', start: line.index, contentStart: lines.lastIndex, char: marker[1][0], length: marker[1].length };
        }
    }
    if (fence) ranges.push({ ...fence, end: text.length, contentEnd: text.length, closed: false });
    const comments = /<!--[\s\S]*?(?:-->|$)/g;
    for (const match of text.matchAll(comments)) {
        if (!ranges.some(r => match.index >= r.start && match.index < r.end)) {
            ranges.push({ kind: 'comment', start: match.index, end: match.index + match[0].length, closed: match[0].endsWith('-->') });
        }
    }
    const ticks = /`+/g;
    let match;
    while ((match = ticks.exec(text))) {
        if (isEscaped(text, match.index) || ranges.some(r => match.index >= r.start && match.index < r.end)) continue;
        const closers = /`+/g;
        closers.lastIndex = ticks.lastIndex;
        let close;
        while ((close = closers.exec(text))) {
            if (close[0].length !== match[0].length || isEscaped(text, close.index)) continue;
            if (ranges.some(r => r.start < closers.lastIndex && r.end > match.index)) break;
            ranges.push({ kind: 'inline', start: match.index, end: closers.lastIndex, closed: true });
            ticks.lastIndex = closers.lastIndex;
            break;
        }
    }
    return ranges.sort((a, b) => a.start - b.start);
}

export function rangeAt(ranges, index) {
    return ranges.find(r => index >= r.start && index < r.end);
}

export const DEFAULT_ENVELOPES = ['think', 'thinking', 'reasoning', 'analysis'];

// Only leading envelopes are recognized. Quoted literal closing tags stay literal.
// A standalone closing delimiter can end an otherwise unclosed fence in reasoning.
export function splitLeadingReasoning(value, tags = DEFAULT_ENVELOPES) {
    const text = String(value ?? '');
    const names = tags.map(t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    if (!names) return null;
    const opening = text.match(new RegExp(`^\\s*<\\s*(${names})\\s*>`, 'i'));
    if (!opening) {
        const prefix = text.trimStart().toLowerCase();
        if (prefix && tags.some(t => `<${t.toLowerCase()}>`.startsWith(prefix))) {
            return { reasoning: '', content: '', raw: text, complete: false, partial: true };
        }
        return null;
    }
    const start = opening[0].length;
    const tail = text.slice(start);
    const ranges = codeRanges(tail);
    const closing = new RegExp(`<\\s*\\/\\s*${opening[1]}\\s*>`, 'gi');
    for (const match of tail.matchAll(closing)) {
        if (isEscaped(tail, match.index)) continue;
        const range = rangeAt(ranges, match.index);
        if (range) {
            const before = tail.slice(tail.lastIndexOf('\n', match.index - 1) + 1, match.index);
            const after = tail.slice(match.index + match[0].length).split('\n')[0];
            if (range.closed || range.kind !== 'fence' || before.trim() || after.trim()) continue;
        }
        const end = start + match.index + match[0].length;
        return { reasoning: tail.slice(0, match.index), content: text.slice(end), raw: text.slice(0, end), complete: true, partial: false };
    }
    return { reasoning: tail, content: '', raw: text, complete: false, partial: false };
}
