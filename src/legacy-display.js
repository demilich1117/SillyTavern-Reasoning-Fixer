import { createDisplayPlan, escapeHtml } from './display.js';
import { splitLeadingReasoning } from './syntax.js';

/**
 * TT 2.3.0 / ST 1.18 lack MessageFormatter. Intercept only the host converter,
 * before its result reaches DOMPurify or the DOM. Reformat the isolated body
 * from raw text so regex/Markdown output derived from thinking is discarded.
 * ReasoningHandler supplies an explicit synchronous scope for native reasoning.
 * No chat fields, display_text or handler text are rewritten, even temporarily.
 */
export function installLegacyProtection({ core, showdown, ReasoningHandler, getContext, getSettings, renderReasoning }) {
    if (!core.converter?.makeHtml || !ReasoningHandler?.prototype?.updateDom || !showdown?.Converter) {
        throw new Error('宿主缺少已核验的 Markdown / Reasoning 接口，无法开启显示保护');
    }
    let scope = null;
    let bodyCapture = null;
    let active = true;
    const patched = new WeakMap();
    const initialConverter = core.converter;
    const originalUpdate = ReasoningHandler.prototype.updateDom;
    const OriginalConverter = showdown.Converter;

    function installOn(converter) {
        if (!converter?.makeHtml || patched.has(converter)) return;
        const original = converter.makeHtml;
        function guarded(text, ...args) {
            if (!active || this !== core.converter) return original.call(this, text, ...args);
            if (bodyCapture) {
                const frame = bodyCapture;
                if (frame.running) return original.call(this, text, ...args);
                frame.running = true;
                try {
                    frame.html = original.call(this, text, ...args);
                    // Capture before host sanitization/CSS scoping. Returning an
                    // empty string lets the nested call finish without processing
                    // the body twice; only the outer pipeline receives its HTML.
                    return '';
                } finally { frame.running = false; }
            }
            const settings = getSettings();
            if (!settings.enabled || !settings.displayProtection) return original.call(this, text, ...args);
            const raw = String(core.mesForShowdownParse ?? '');
            let ctx = scope;
            if (!ctx) {
                if (!splitLeadingReasoning(raw)) return original.call(this, text, ...args);
                // Ambiguous/user/tool matches are deliberately not inferred as AI text.
                const chat = getContext().chat || [];
                const matches = [];
                for (let id = chat.length - 1; id >= 0; id--) {
                    const message = chat[id];
                    if (String(message.extra?.display_text || message.mes || '') === raw) matches.push({ message, id });
                    if (matches.length > 1) break;
                }
                if (matches.length !== 1) return original.call(this, text, ...args);
                const { message, id } = matches[0];
                ctx = { messageId: id, isReasoning: false, isUser: !!message.is_user, isSystem: !!message.is_system || message.role === 'tool', name: message.name };
            }
            const plan = createDisplayPlan(ctx.isReasoning ? ctx.raw : raw, ctx, settings, renderReasoning);
            if (!plan) return original.call(this, text, ...args);
            if (plan.replace || !plan.body) return plan.html;
            const previous = bodyCapture;
            const frame = { html: null, running: false };
            bodyCapture = frame;
            try {
                core.messageFormatting(plan.body, ctx.name || '', false, false, ctx.messageId);
                return plan.html + (frame.html ?? escapeHtml(plan.body));
            } finally { bodyCapture = previous; }
        }
        converter.makeHtml = guarded;
        patched.set(converter, { original, guarded });
    }

    function protectedUpdate(messageId, ...args) {
        installOn(core.converter);
        const previous = scope;
        scope = { messageId, isReasoning: true, isUser: false, isSystem: false, raw: this.reasoningDisplayText ?? this.reasoning ?? '' };
        try { return originalUpdate.call(this, messageId, ...args); }
        finally { scope = previous; }
    }
    const WrappedConverter = new Proxy(OriginalConverter, {
        construct(target, args, newTarget) {
            const converter = Reflect.construct(target, args, newTarget);
            installOn(converter);
            return converter;
        },
    });
    installOn(core.converter);
    showdown.Converter = WrappedConverter;
    ReasoningHandler.prototype.updateDom = protectedUpdate;
    return {
        mode: 'legacy',
        reset() { scope = null; installOn(core.converter); },
        dispose() {
            active = false;
            if (showdown.Converter === WrappedConverter) showdown.Converter = OriginalConverter;
            if (ReasoningHandler.prototype.updateDom === protectedUpdate) ReasoningHandler.prototype.updateDom = originalUpdate;
            for (const converter of new Set([initialConverter, core.converter])) {
                const patch = patched.get(converter);
                if (patch && converter.makeHtml === patch.guarded) converter.makeHtml = patch.original;
            }
        },
    };
}
