import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import showdown from 'showdown';
import createDOMPurify from 'dompurify';
import { createReasoningRenderer, escapeHtml, installFormatterProtection } from '../src/display.js';
import { installLegacyProtection } from '../src/legacy-display.js';
import { normalizeSettings } from '../src/storage.js';

function fixture(name) { return fs.readFileSync(new URL(`fixtures/${name}.txt`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'); }
function environment(kind, overrides = {}) {
    const window = new JSDOM('<!doctype html><main></main>').window;
    const DOMPurify = createDOMPurify(window);
    const hookSource = fixture(`${kind}-sanitize-hooks`).replace('export function', 'function');
    new Function('DOMPurify', 'HTMLUnknownElement', 'document', 'NodeFilter', 'isExternalMediaAllowed', `${hookSource}\naddDOMPurifyHooks();`)(DOMPurify, window.HTMLUnknownElement, window.document, window.NodeFilter, () => true);
    const localShowdown = { Converter: showdown.Converter };
    const renderReasoning = createReasoningRenderer({ showdown: localShowdown, DOMPurify });
    const formatterSource = fixture('st-message-formatter').replace(/^import .*;$/gm, '').replace(/^export .*;$/gm, '').replace(/^export /gm, '');
    const formatter = new Function(`${formatterSource}\nreturn MessageFormatter.instance;`)();
    const chat = [{ name: 'AI', is_user: false, mes: '', extra: {} }];
    const settings = normalizeSettings({});
    const calls = [];
    const globals = {
        chat, MessageFormatter: formatter, DOMPurify,
        power_user: { reasoning: { prefix: '<think>', suffix: '</think>' }, allow_name2_display: true, encode_tags: false },
        COMMENT_NAME_DEFAULT: 'comment', systemUserName: 'system',
        substituteParams: x => x, fixMarkdown: x => x, escapeHtml,
        canUseNegativeLookbehind: () => true,
        regex_placement: { REASONING: 6, AI_OUTPUT: 2, USER_INPUT: 1, SLASH_COMMAND: 5 },
        getRegexedString(text, placement) {
            calls.push({ text, placement });
            // A real-world body regex may mistake tags mentioned by thinking.
            return text.replace(/<content>([\s\S]*?)<\/content>/g, '<article>$1</article>');
        },
        encodeStyleTags: x => x, decodeStyleTags: x => x,
        substituteFirstMessage: x => x, normalizeMessageSystemFlag: (_name, flag) => flag,
        removeMessagePromptBias: x => x,
        getMessageFormattingRegexContext: (isUser, _id, isReasoning) => ({ placement: isReasoning ? 6 : isUser ? 1 : 2 }),
        ...overrides,
    };
    const code = fixture(`${kind}-message-formatting`).replace('export function', 'function');
    const core = new Function(...Object.keys(globals), 'initialConverter', `
        let converter = initialConverter, mesForShowdownParse;
        ${code}
        return { messageFormatting, get converter() { return converter; }, set converter(value) { converter = value; }, get mesForShowdownParse() { return mesForShowdownParse; } };
    `)(...Object.values(globals), new localShowdown.Converter({ simpleLineBreaks: true }));
    class ReasoningHandler {
        updateDom(id) { return core.messageFormatting(this.reasoningDisplayText ?? this.reasoning, '', false, false, id, {}, true); }
    }
    const protection = kind === 'st'
        ? installFormatterProtection(formatter, () => settings, renderReasoning)
        : installLegacyProtection({ core, showdown: localShowdown, ReasoningHandler, getContext: () => ({ chat }), getSettings: () => settings, renderReasoning });
    function render(text) {
        chat[0].mes = text;
        const before = JSON.stringify(chat);
        const html = core.messageFormatting(text, 'AI', false, false, 0);
        assert.equal(JSON.stringify(chat), before, 'rendering must not mutate chat');
        const div = window.document.createElement('div');
        div.innerHTML = html;
        return div;
    }
    return { settings, calls, core, chat, render, ReasoningHandler, localShowdown, protection, window };
}

for (const kind of ['st', 'tt']) {
    test(`${kind}: body CSS and code entities pass through host postprocessing once`, () => {
        let scopes = 0;
        const env = environment(kind, {
            encodeStyleTags: text => text.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => `<custom-style>${encodeURIComponent(css)}</custom-style>`),
            // Model the upstream non-idempotent selector prefix operation.
            decodeStyleTags: text => text.replace(/<custom-style>(.*?)<\/custom-style>/g, (_, css) => {
                scopes++;
                return `<style>.mes_text ${decodeURIComponent(css)}</style>`;
            }),
        });
        const body = '<style>p{color:red}</style>\n\n`&amp;lt;style&amp;gt;`';
        const expected = env.render(body);
        scopes = 0;
        const dom = env.render(`<think>思考中的 <style>p{display:none}</style></think>\n${body}`);
        assert.equal(scopes, 1, 'body styles must not be scoped twice');
        assert.equal(dom.querySelector('style')?.textContent, expected.querySelector('style')?.textContent);
        assert.equal(dom.querySelector('code')?.textContent, expected.querySelector('code')?.textContent);
        env.protection.dispose(); env.window.close();
    });
    test(`${kind}: isolates hostile markup and incomplete code from formatted body`, () => {
        const env = environment(kind);
        const text = '<think><style>p{display:none}</style><img src=x onerror=alert(1)>\n```html\n</think>\n<content>正文</content>\n\n**加粗正文**';
        const dom = env.render(text);
        assert.equal(dom.querySelectorAll('details.custom-reasoning-fixer-isolated').length, 1);
        assert.equal(dom.querySelectorAll('style,img,iframe,script').length, 0);
        assert.equal(dom.querySelector('article')?.textContent, '正文');
        assert.equal(dom.querySelector('strong')?.textContent, '加粗正文');
        assert.match(dom.querySelector('.custom-reasoning-fixer-plain').textContent, /<style>/);
        if (kind === 'st') assert.ok(env.calls.every(call => !call.text.includes('<style>')), 'ST strips thoughts before body regex');
        env.protection.dispose();
        env.window.close();
    });
    test(`${kind}: native thoughts remain text while basic markdown preserves emphasis`, () => {
        const env = environment(kind);
        const handler = new env.ReasoningHandler();
        handler.reasoning = '**强调** <style>p{display:none}</style> `标签`';
        const before = JSON.stringify(handler);
        let html = handler.updateDom(0);
        assert.match(html, /\*\*强调\*\*/);
        env.settings.reasoningDisplayMode = 'markdown';
        html = handler.updateDom(0);
        const root = env.window.document.createElement('div');
        root.innerHTML = html;
        assert.equal(root.querySelector('strong')?.textContent, '强调');
        assert.equal(root.querySelector('code')?.textContent, '标签');
        assert.equal(root.querySelector('style'), null);
        assert.equal(JSON.stringify(handler), before);
        env.protection.dispose(); env.window.close();
    });
    test(`${kind}: every stream prefix is inert; disabling restores ordinary formatting`, () => {
        const env = environment(kind);
        const text = '<think><style>body{display:none}</style>\n```\n</think>\n**正文**';
        for (let index = 1; index <= text.length; index++) {
            const dom = env.render(text.slice(0, index));
            assert.equal(dom.querySelector('style'), null, `style at ${index}`);
            assert.ok(dom.querySelector('.custom-reasoning-fixer-isolated'), `unprotected at ${index}`);
        }
        env.settings.displayProtection = false;
        assert.equal(env.render(text).querySelector('.custom-reasoning-fixer-isolated'), null);
        env.settings.displayProtection = true;
        assert.ok(env.render(text).querySelector('.custom-reasoning-fixer-isolated'));
        env.protection.dispose(); env.window.close();
    });
    test(`${kind}: ordinary output and user messages keep original formatting`, () => {
        const env = environment(kind);
        const ordinary = env.render('<content>正文</content>\n\n**加粗正文**');
        assert.equal(ordinary.querySelector('article')?.textContent, '正文');
        assert.equal(ordinary.querySelector('strong')?.textContent, '加粗正文');
        const raw = '<think>用户讨论格式</think>后文';
        env.chat[0] = { mes: raw, is_user: true, extra: {} };
        assert.ok(!env.core.messageFormatting(raw, 'User', false, true, 0).includes('reasoning-fixer-isolated'));
        env.protection.dispose(); env.window.close();
    });
}

test('TT adapter survives converter rebuild and disposes without clobbering another wrapper', () => {
    const env = environment('tt');
    env.core.converter = new env.localShowdown.Converter();
    assert.ok(env.render('<think>思考</think>正文').querySelector('.custom-reasoning-fixer-isolated'));
    const guard = env.core.converter.makeHtml;
    const otherWrapper = function (...args) { return guard.apply(this, args); };
    env.core.converter.makeHtml = otherWrapper;
    env.protection.dispose();
    assert.equal(env.core.converter.makeHtml, otherWrapper);
    assert.equal(env.render('<think>思考</think>正文').querySelector('.custom-reasoning-fixer-isolated'), null);
    env.window.close();
});
