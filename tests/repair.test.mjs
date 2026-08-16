import test from 'node:test';
import assert from 'node:assert/strict';

import {
    extractConfiguredBlocks,
    extractFromFirstConfiguredTag,
    extractReasoningEnvelope,
    repairMessage,
} from '../src/repair.js';
import { normalizeProfile } from '../src/storage.js';

const profile = {
    id: 'novel',
    name: '小说',
    extractionMode: 'configured_blocks',
    preserveTags: true,
    caseSensitive: false,
    allowNested: false,
    tags: [
        { name: 'novel_header', preserve: true },
        { name: 'content', preserve: true },
        { name: 'table_edit', preserve: true },
    ],
};

test('extracts a conventional think envelope', () => {
    assert.deepEqual(
        extractReasoningEnvelope('<think>分析过程</think>正文'),
        { reasoning: '分析过程', content: '正文' },
    );
});

test('moves configured structured blocks and retains reasoning', () => {
    const message = {
        is_user: false,
        mes: '',
        extra: {
            reasoning: '先分析。\n<novel_header>\n标题\n</novel_header>\n<content>正文</content>\n<table_edit>表格内容</table_edit>',
        },
    };

    const result = repairMessage(message, profile);

    assert.equal(result.changed, true);
    assert.match(message.mes, /<novel_header>\s*标题\s*<\/novel_header>/);
    assert.match(message.mes, /<content>正文<\/content>/);
    assert.match(message.mes, /<table_edit>表格内容<\/table_edit>/);
    assert.equal(message.extra.reasoning, '先分析。');
});

test('repairs content with a profile configured using a wrapped tag name', () => {
    const wrappedProfile = normalizeProfile({
        id: 'wrapped',
        name: '包裹标签配置',
        tags: ['<content>'],
    }, 'wrapped');
    const message = {
        is_user: false,
        mes: '',
        extra: { reasoning: '分析过程\n<content>正文</content>' },
    };

    const result = repairMessage(message, wrappedProfile);

    assert.equal(result.changed, true);
    assert.equal(message.extra.reasoning, '分析过程');
    assert.equal(message.mes, '<content>正文</content>');
});

test('moves the complete suffix from the first configured tag', () => {
    const boundaryProfile = {
        ...profile,
        extractionMode: 'from_first_tag',
        tags: [{ name: 'novel_header', preserve: true }],
    };
    const message = {
        is_user: false,
        mes: '',
        extra: {
            reasoning: '先分析。\n<novel_header>标题</novel_header>\n<content>正文</content>\n<table_edit>表格内容</table_edit>',
        },
    };

    const result = repairMessage(message, boundaryProfile);

    assert.equal(result.changed, true);
    assert.equal(
        message.mes,
        '<novel_header>标题</novel_header>\n<content>正文</content>\n<table_edit>表格内容</table_edit>',
    );
    assert.equal(message.extra.reasoning, '先分析。');
});

test('skips an unclosed draft mention of the selected start tag', () => {
    const boundaryProfile = {
        ...profile,
        extractionMode: 'from_first_tag',
        tags: [{ name: 'novel_header', preserve: true }],
    };
    const draft = [
        '规划输出结构：',
        ' -> <novel_header>',
        ' -> <content>（含锚定）',
        ' -> <UpdateVariable>',
        ' -> <tableEdit>',
        ' -> <branches>',
        '继续思考。',
    ].join('\n');
    const output = '<novel_header>标题</novel_header>\n<content>正文</content>';
    const message = {
        is_user: false,
        mes: '',
        extra: { reasoning: `${draft}\n${output}` },
    };

    const result = repairMessage(message, boundaryProfile);

    assert.equal(result.changed, true);
    assert.equal(message.mes, output);
    assert.equal(message.extra.reasoning, draft);
});

test('skips an earlier complete draft block with the selected start tag', () => {
    const boundaryProfile = {
        ...profile,
        extractionMode: 'from_first_tag',
        tags: [{ name: 'novel_header', preserve: true }],
    };
    const draft = '<novel_header>草稿标题</novel_header>\n继续检查草稿。';
    const output = '<novel_header>正式标题</novel_header>\n<content>正式正文</content>';
    const message = {
        is_user: false,
        mes: '',
        extra: { reasoning: `${draft}\n${output}` },
    };

    const result = repairMessage(message, boundaryProfile);

    assert.equal(result.changed, true);
    assert.equal(message.mes, output);
    assert.equal(message.extra.reasoning, draft);
});

test('does not move an arrow-linked tag sequence from reasoning', () => {
    const boundaryProfile = {
        ...profile,
        extractionMode: 'from_first_tag',
        tags: [{ name: 'novel_header', preserve: true }],
    };
    const draft = [
        '规划最终输出顺序：',
        '<novel_header> -> 风格/剧情锚定 -> <content> -> 进度/写作锚定 -> <branches> -> <UpdateVariable> -> <tableEdit>。',
        '继续推演剧情。',
    ].join('\n');
    const message = {
        is_user: false,
        mes: '',
        extra: { reasoning: draft },
    };

    const result = repairMessage(message, boundaryProfile);

    assert.equal(result.changed, false);
    assert.equal(message.mes, '');
    assert.equal(message.extra.reasoning, draft);
});

test('still moves ordinary tagged content that contains an arrow', () => {
    const boundaryProfile = {
        ...profile,
        extractionMode: 'from_first_tag',
        tags: [{ name: 'novel_header', preserve: true }],
    };
    const output = '<novel_header>主标题 -> 副标题</novel_header>\n<content>正文</content>';
    const message = {
        is_user: false,
        mes: '',
        extra: { reasoning: `分析。\n${output}` },
    };

    const result = repairMessage(message, boundaryProfile);

    assert.equal(result.changed, true);
    assert.equal(message.mes, output);
    assert.equal(message.extra.reasoning, '分析。');
});

test('does not move a draft tag when the real start tag is already visible', () => {
    const boundaryProfile = {
        ...profile,
        extractionMode: 'from_first_tag',
        tags: [{ name: 'novel_header', preserve: true }],
    };
    const draft = '先用 <novel_header> 标记标题，随后再组织正文。';
    const output = '<novel_header>正式标题</novel_header>\n<content>正式正文</content>';
    const message = {
        is_user: false,
        mes: output,
        extra: { reasoning: draft },
    };

    const result = repairMessage(message, boundaryProfile);

    assert.equal(result.changed, false);
    assert.equal(message.mes, output);
    assert.equal(message.extra.reasoning, draft);
});

test('keeps unconfigured nested MVU tags without listing each one', () => {
    const boundaryProfile = {
        ...profile,
        extractionMode: 'from_first_tag',
        tags: [{ name: 'UpdateVarible', preserve: true }],
    };
    const source = '分析\n<UpdateVarible>\n<Analystic>说明</Analystic>\n<JsonPatch>[{"op":"add"}]</JsonPatch>\n</UpdateVarible>';

    const direct = extractFromFirstConfiguredTag(source, boundaryProfile);
    assert.equal(direct.blocks.length, 1);
    assert.equal(direct.blocks[0].value, source.slice(source.indexOf('<UpdateVarible>')));

    const message = { is_user: false, mes: '', extra: { reasoning: source } };
    repairMessage(message, boundaryProfile);
    assert.match(message.mes, /<Analystic>说明<\/Analystic>/);
    assert.match(message.mes, /<JsonPatch>\[\{"op":"add"\}\]<\/JsonPatch>/);
    assert.equal(message.extra.reasoning, '分析');
});

test('is idempotent', () => {
    const message = {
        is_user: false,
        mes: '',
        extra: { reasoning: '<content>正文</content>' },
    };

    assert.equal(repairMessage(message, profile).changed, true);
    const snapshot = JSON.stringify(message);
    assert.equal(repairMessage(message, profile).changed, false);
    assert.equal(JSON.stringify(message), snapshot);
});

test('updates a display_text mirror when it mirrors the old message', () => {
    const message = {
        is_user: false,
        mes: '',
        extra: {
            reasoning: '<content>正文</content>',
            display_text: '',
        },
    };

    const result = repairMessage(message, profile);
    assert.equal(result.changed, true);
    assert.equal(message.extra.display_text, '<content>正文</content>');
});

test('can strip tags for an individual configured tag', () => {
    const stripProfile = {
        ...profile,
        tags: [{ name: 'content', preserve: false }],
    };
    const result = extractConfiguredBlocks('<content>正文</content>', stripProfile);
    assert.equal(result.remaining, '');
    assert.deepEqual(result.blocks.map((block) => block.value), ['正文']);
});

test('supports case-insensitive tag matching by default', () => {
    const result = extractConfiguredBlocks('<CONTENT>正文</CONTENT>', profile);
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0].value, '<CONTENT>正文</CONTENT>');
});

test('leaves unclosed configured blocks untouched', () => {
    const result = extractConfiguredBlocks('<content>可能仍在生成', profile);
    assert.equal(result.blocks.length, 0);
    assert.equal(result.remaining, '<content>可能仍在生成');
});

test('repairs swipe text and swipe metadata', () => {
    const message = {
        is_user: false,
        mes: '<content>当前</content>',
        extra: { reasoning: '' },
        swipe_id: 0,
        swipes: ['<content>当前</content>', '<content>另一个</content>'],
        swipe_info: [
            { extra: { reasoning: '' } },
            { extra: { reasoning: '<content>另一个</content>' } },
        ],
    };

    const result = repairMessage(message, profile);
    assert.equal(result.changed, true);
    assert.equal(message.mes, '<content>当前</content>');
    assert.equal(message.swipes[0], '<content>当前</content>');
    assert.equal(message.swipes[1], '<content>另一个</content>');
    assert.equal(message.swipe_info[1].extra.reasoning, undefined);
});
