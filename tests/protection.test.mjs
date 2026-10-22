import test from 'node:test';
import assert from 'node:assert/strict';
import { repairMessage } from '../src/repair.js';
import { splitLeadingReasoning } from '../src/syntax.js';
import { normalizeProfile, normalizeSettings } from '../src/storage.js';
import { createDisplayPlan, escapeHtml } from '../src/display.js';

const profile = normalizeProfile({ tags: ['content'] }, 'test');
const tick = '`';
const fence = tick.repeat(3);

for (const reasoning of [
    '接下来使用 `<content>` 标签。\n我还在分析。',
    '双反引号 ``<content>`` 也只是示例。',
    `格式示例：\n${fence}html\n<content>示例</content>\n${fence}\n继续分析。`,
    '示例：\n~~~html\n<content>示例</content>\n~~~\n继续分析。',
    '<!-- <content>注释 -->分析。',
    '\\<content>转义标签。',
]) test(`keeps quoted markup intact: ${reasoning.slice(0, 20)}`, () => {
    const message = { mes: '', extra: { reasoning } };
    const before = structuredClone(message);
    assert.equal(repairMessage(message, profile).changed, false);
    assert.deepEqual(message, before);
});

test('ignores example then moves real output without leaving dangling ticks', () => {
    const message = { mes: '', extra: { reasoning: '使用 `<content>` 标签。\n<content>正式正文</content>' } };
    repairMessage(message, profile);
    assert.equal(message.mes, '<content>正式正文</content>');
    assert.equal(message.extra.reasoning, '使用 `<content>` 标签。');
});

test('fenced output requires opt-in and unwraps the whole trailing fence', () => {
    const text = `分析。\n${fence}html\n<content>正文</content>\n${fence}`;
    const message = { mes: '', extra: { reasoning: text } };
    assert.equal(repairMessage(message, profile).changed, false);
    repairMessage(message, { ...profile, fencedOutput: 'unwrap' });
    assert.equal(message.mes, '<content>正文</content>');
    assert.equal(message.extra.reasoning, '分析。');
    const example = { mes: '', extra: { reasoning: text + '\n继续分析。' } };
    assert.equal(repairMessage(example, { ...profile, fencedOutput: 'unwrap' }).changed, false);
});

test('real repair path honors tag preservation without stripping nested tags', () => {
    const message = { mes: '', extra: { reasoning: '分析\n<content><b>正文</b></content><JsonPatch>[]</JsonPatch>' } };
    repairMessage(message, { ...profile, preserveTags: false });
    assert.equal(message.mes, '<b>正文</b><JsonPatch>[]</JsonPatch>');
});

test('updates mirrored reasoning display, drops stale translation and signature', () => {
    for (const mirrored of [true, false]) {
        const text = '思考\n<content>正文</content>';
        const message = { mes: '', extra: { reasoning: text, reasoning_display_text: mirrored ? text : '旧翻译', reasoning_signature: 'old' } };
        repairMessage(message, profile);
        assert.equal(message.extra.reasoning_display_text, mirrored ? '思考' : undefined);
        assert.equal(message.extra.reasoning_signature, undefined);
    }
});

test('preserves cold swipes and unrelated selected-swipe metadata', () => {
    const message = { mes: '', extra: { reasoning: '<content>正文</content>' }, swipe_id: 0,
        swipes: ['', null], swipe_info: [{ extra: { providerData: 'keep' } }, { extra: { reasoning: '<content>冷数据</content>' } }] };
    repairMessage(message, profile);
    assert.equal(message.swipes[1], null);
    assert.equal(message.swipe_info[1].extra.reasoning, '<content>冷数据</content>');
    assert.equal(message.swipe_info[0].extra.providerData, 'keep');
});

test('does not rewrite tool, user or system messages', () => {
    for (const role of [{ is_user: true }, { is_system: true }, { role: 'tool' }]) {
        const message = { ...role, mes: '', extra: { reasoning: '<content>正文</content>' } };
        assert.equal(repairMessage(message, profile).changed, false);
    }
});

test('envelope parser ignores quoted closers but accepts a real closer after broken fence', () => {
    assert.equal(splitLeadingReasoning('<think>引用 `</think>` 然后继续</think>正文').content, '正文');
    assert.equal(splitLeadingReasoning(`<think>\n${fence}html\n<div>\n</think>\n正文`).content, '\n正文');
    assert.equal(splitLeadingReasoning(`<think>\n${fence}\n</think>\n${fence}\n继续</think>正文`).content, '正文');
});

test('all streaming prefixes are isolated without mutating source', () => {
    const text = '<think><style>body{display:none}</style>\n```html\n</think>\n**正文**';
    const settings = normalizeSettings({});
    for (let end = 1; end <= text.length; end++) {
        const prefix = text.slice(0, end);
        const plan = createDisplayPlan(prefix, {}, settings, escapeHtml);
        assert.ok(plan, `missing plan at ${end}`);
        assert.ok(!plan.body.includes('<style>'));
        assert.ok(!plan.html.includes('<style>'));
    }
});

test('missing delimiter keeps original visible and never invents a body boundary', () => {
    const text = '<think>思考\n可能是正文，但没有结束标记';
    const plan = createDisplayPlan(text, {}, normalizeSettings({}), escapeHtml);
    assert.equal(plan.body, '');
    assert.match(plan.html, /<details[^>]* open>/);
    assert.match(plan.html, /可能是正文/);
    const message = { mes: text, extra: {} };
    assert.equal(repairMessage(message, profile).changed, false);
});

test('normalization preserves independent switches and unknown extension fields', () => {
    const settings = normalizeSettings({ repairOnMessage: false, displayProtection: true, future: 42,
        profiles: { custom: { id: 'custom', tags: ['content'], fencedOutput: 'unwrap', futureProfile: 'keep' } } });
    assert.equal(settings.repairOnMessage, false);
    assert.equal(settings.displayProtection, true);
    assert.equal(settings.future, 42);
    assert.equal(settings.profiles.custom.futureProfile, 'keep');
    assert.equal(settings.profiles.custom.fencedOutput, 'unwrap');
    assert.equal(createDisplayPlan('<think>x</think>body', {}, { ...settings, displayProtection: false }, escapeHtml), null);
});
