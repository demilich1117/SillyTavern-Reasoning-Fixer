import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CHAT_PROFILE_KEY,
    DEFAULT_PROFILE,
    EXTRACTION_MODES,
    getPresetKey,
    getProfileIdForContext,
    normalizeSettings,
} from '../src/storage.js';

test('normalizes the default profile and removes invalid tags', () => {
    const settings = normalizeSettings({
        profiles: {
            custom: {
                id: 'custom',
                name: '自定义',
                tags: ['content', 'bad tag', { name: 'table_edit', preserve: false }],
            },
        },
        defaultProfileId: 'custom',
    });

    assert.equal(settings.defaultProfileId, 'custom');
    assert.deepEqual(settings.profiles.custom.tags, [
        { name: 'content', preserve: true },
        { name: 'table_edit', preserve: false },
    ]);
});

test('uses manual chat selection before preset binding and default', () => {
    const settings = normalizeSettings({
        profiles: {
            default: { id: 'default', name: '默认', tags: [] },
            preset: { id: 'preset', name: '预设', tags: [] },
            manual: { id: 'manual', name: '手动', tags: [] },
        },
        defaultProfileId: 'default',
        presetBindings: { 'openai::小说预设': 'preset' },
    });
    const key = getPresetKey('openai', '小说预设');

    assert.equal(getProfileIdForContext(settings, {}, key), 'preset');
    assert.equal(getProfileIdForContext(settings, { [CHAT_PROFILE_KEY]: 'manual' }, key), 'manual');
    assert.equal(getProfileIdForContext(settings, {}, 'openai::其他预设'), 'default');
});

test('keeps the shipped default profile useful', () => {
    const settings = normalizeSettings({});
    assert.equal(settings.profiles[DEFAULT_PROFILE.id].tags.length, 3);
    assert.equal(settings.profiles[DEFAULT_PROFILE.id].extractionMode, EXTRACTION_MODES.FROM_FIRST_TAG);
});

test('keeps explicitly configured legacy profiles in exact-block mode', () => {
    const settings = normalizeSettings({
        profiles: {
            legacy: { id: 'legacy', name: '旧模式', tags: ['content'] },
        },
        defaultProfileId: 'legacy',
    });
    assert.equal(settings.profiles.legacy.extractionMode, EXTRACTION_MODES.CONFIGURED_BLOCKS);
});
