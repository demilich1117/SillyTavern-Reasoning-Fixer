import { splitLeadingReasoning } from './syntax.js';

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function createReasoningRenderer({ showdown, DOMPurify }) {
    const converter = new showdown.Converter({ simpleLineBreaks: true, strikethrough: true, literalMidWordUnderscores: true });
    return (text, mode = 'plain') => {
        const escaped = escapeHtml(text);
        if (mode !== 'markdown') return `<div class="reasoning-fixer-plain">${escaped}</div>`;
        const html = DOMPurify.sanitize(converter.makeHtml(escaped), {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'pre', 'code', 'blockquote', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
            ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false,
        });
        return `<div class="reasoning-fixer-markdown">${html}</div>`;
    };
}

export function createDisplayPlan(text, context, settings, renderReasoning) {
    if (!settings.enabled || !settings.displayProtection || context.isUser || context.isSystem) return null;
    if (context.isReasoning) {
        return { body: '', html: renderReasoning(text, settings.reasoningDisplayMode), replace: true };
    }
    let body = String(text ?? '');
    let html = '';
    for (let count = 0; count < 64; count++) {
        const part = splitLeadingReasoning(body);
        if (!part) break;
        const label = part.complete ? '思考' : '思考边界未闭合 · 原文';
        const shown = part.complete ? part.reasoning : part.raw;
        html += `<details class="reasoning-fixer-isolated"${part.complete ? '' : ' open'}><summary>${label}</summary>${renderReasoning(shown, part.complete ? settings.reasoningDisplayMode : 'plain')}</details>`;
        body = part.content;
        if (!part.complete) break;
    }
    return html ? { body, html, replace: false } : null;
}

// All stages are synchronous; per-call stacks also support nested formatting.
export function installFormatterProtection(formatter, getSettings, renderReasoning) {
    let active = true;
    const stacks = new Map();
    const keyFor = ctx => `${ctx.messageId}:${!!ctx.isReasoning}:${!!ctx.isUser}:${!!ctx.isSystem}`;
    formatter.addHook((text, ctx) => {
        if (!active) return text;
        const key = keyFor(ctx);
        const stack = stacks.get(key) || [];
        if (stack.length > 32 || stacks.size > 256) stacks.clear();
        const plan = createDisplayPlan(text, ctx, getSettings(), renderReasoning);
        stack.push(plan);
        stacks.set(key, stack);
        return plan ? plan.body : text;
    }, { stage: formatter.stage.BEFORE_REGEX, order: -1000 });
    formatter.addHook((html, ctx) => {
        if (!active) return html;
        const key = keyFor(ctx);
        const stack = stacks.get(key);
        const plan = stack?.pop();
        if (!stack?.length) stacks.delete(key);
        return plan ? plan.html + (plan.replace ? '' : html) : html;
    }, { stage: formatter.stage.AFTER_MARKDOWN, order: 1000 });
    return { mode: 'formatter', reset: () => stacks.clear(), dispose: () => { active = false; stacks.clear(); } };
}
