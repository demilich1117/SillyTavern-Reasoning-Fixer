import { escapeHtml } from '/src/display.js';
import { ReasoningHandler } from '/scripts/reasoning.js';
const isTT = new URLSearchParams(location.search).get('host') === 'tt';
const kind = isTT ? 'tt' : 'st';
const hookSource = await (await fetch(`/tests/fixtures/${kind}-sanitize-hooks.txt`)).text();
new Function('DOMPurify', 'isExternalMediaAllowed', `${hookSource.replace('export function', 'function')}\naddDOMPurifyHooks();`)(window.DOMPurify, () => true);
const formatterSource = await (await fetch('/tests/fixtures/st-message-formatter.txt')).text();
const formatter = new Function(`${formatterSource.replace(/^import .*;$/gm, '').replace(/^export .*;$/gm, '').replace(/^export /gm, '')}\nreturn MessageFormatter.instance;`)();
export const chat = [];
const eventTypes = Object.fromEntries(['MESSAGE_RECEIVED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'CHAT_CHANGED', 'PRESET_CHANGED', 'APP_READY'].map(name => [name, name]));
const listeners = new Map();
const eventSource = {
    on(event, callback) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(callback); },
    makeLast(event, callback) { this.on(event, callback); },
    async emit(event, ...args) { for (const callback of listeners.get(event) || []) await callback(...args); },
};
let generating = false;
let chatId = 'first';
const settings = {};
let metadata = {};
let saves = 0;
let registrations = 0;
const globals = {
    chat, MessageFormatter: formatter, DOMPurify: window.DOMPurify,
    power_user: { reasoning: { prefix: '<think>', suffix: '</think>' }, allow_name2_display: true },
    COMMENT_NAME_DEFAULT: 'comment', systemUserName: 'system',
    substituteParams: x => x, fixMarkdown: x => x, escapeHtml, canUseNegativeLookbehind: () => true,
    regex_placement: { REASONING: 6, AI_OUTPUT: 2, USER_INPUT: 1, SLASH_COMMAND: 5 },
    getRegexedString: text => text.replace(/<content>([\s\S]*?)<\/content>/g, '<article>$1</article>'),
    encodeStyleTags: x => x, decodeStyleTags: x => x,
    substituteFirstMessage: x => x, normalizeMessageSystemFlag: (_name, flag) => flag,
    removeMessagePromptBias: x => x,
    getMessageFormattingRegexContext: (user, _id, reasoning) => ({ placement: reasoning ? 6 : user ? 1 : 2 }),
};
const source = await (await fetch(`/tests/fixtures/${kind}-message-formatting.txt`)).text();
// Execute the upstream formatter excerpt with explicit host stubs; no real chat/API.
const run = new Function(...Object.keys(globals), 'initialConverter', `
 let converter = initialConverter, mesForShowdownParse;
 ${source.replace('export function', 'function')}
 return { messageFormatting, get raw() { return mesForShowdownParse; }, set converter(value) { converter = value; } };
`)(...Object.values(globals), new window.showdown.Converter({ simpleLineBreaks: true }));
export let converter = new window.showdown.Converter({ simpleLineBreaks: true });
run.converter = converter;
export let mesForShowdownParse;
export function messageFormatting(...args) {
    // TT's exported raw binding is set before makeHtml is entered.
    mesForShowdownParse = args[0];
    return run.messageFormatting(...args);
}
export const isGenerating = () => generating;
export function updateMessageBlock(id, message) {
    let element = document.querySelector(`.mes[mesid="${id}"]`);
    if (!element) {
        element = document.createElement('section'); element.className = 'mes'; element.setAttribute('mesid', id);
        element.innerHTML = '<details open><summary>原生思考栏</summary><div class="mes_reasoning"></div></details><div class="mes_text"></div>';
        document.querySelector('#chat').append(element);
    }
    const handler = new ReasoningHandler();
    handler.reasoning = message.extra?.reasoning || '';
    handler.reasoningDisplayText = message.extra?.reasoning_display_text;
    handler.updateDom(id);
    element.querySelector('.mes_text').innerHTML = messageFormatting(message.extra?.display_text || message.mes, message.name, !!message.is_system, !!message.is_user, id);
}
const ctx = () => ({ chat, chatId, chatMetadata: metadata, extensionSettings: settings, eventSource, eventTypes,
    ...(isTT ? {} : { messageFormatter: formatter }), saveSettingsDebounced() {}, saveMetadataDebounced() {},
    async saveChat() { saves++; },
});
window.SillyTavern = { getContext: ctx, libs: { showdown: window.showdown, DOMPurify: window.DOMPurify } };
if (isTT) window.__TAURITAVERN__ = { ready: Promise.resolve(), api: { chatSurface: {
    isManagedOwnershipRequired: () => true,
    registerContentProcessor() { registrations++; return { async refresh() { if (!generating) chat.forEach((message, id) => updateMessageBlock(id, message)); } }; },
} } };
window.toastr = Object.fromEntries(['info', 'success', 'warning', 'error'].map(type => [type, message => { document.querySelector('#notice').textContent = message; }]));
window.testApi = {
    kind, settings, chat, events: eventSource,
    get saves() { return saves; }, get registrations() { return registrations; },
    setMessage(message) { chat.splice(0, chat.length, { name: 'AI', mes: '', extra: {}, ...message }); updateMessageBlock(0, chat[0]); },
    async start(message) { generating = true; await eventSource.emit('GENERATION_STARTED', 'normal', {}, false); this.setMessage(message); await eventSource.emit('MESSAGE_UPDATED', 0); },
    async finish() { generating = false; await eventSource.emit('GENERATION_ENDED'); await new Promise(resolve => setTimeout(resolve, 0)); },
    async changeChat() { generating = false; chatId += '-next'; metadata = {}; chat.splice(0); document.querySelector('#chat').replaceChildren(); await eventSource.emit('CHAT_CHANGED'); },
    remount() { document.querySelector('#chat').replaceChildren(); chat.forEach((message, id) => updateMessageBlock(id, message)); },
    get listeners() { return Object.fromEntries([...listeners].map(([name, list]) => [name, list.length])); },
};
