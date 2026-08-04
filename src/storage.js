export const EXTENSION_KEY = 'reasoningFixer';
export const CHAT_PROFILE_KEY = 'reasoningFixerProfileId';
export const AUTO_PROFILE_ID = '__auto__';

export const EXTRACTION_MODES = Object.freeze({
    CONFIGURED_BLOCKS: 'configured_blocks',
    FROM_FIRST_TAG: 'from_first_tag',
});

export const DEFAULT_TAGS = Object.freeze([
    { name: 'novel_header', preserve: true },
    { name: 'content', preserve: true },
    { name: 'table_edit', preserve: true },
]);

export const DEFAULT_PROFILE = Object.freeze({
    id: 'novel-structured',
    name: '小说结构化输出',
    extractionMode: EXTRACTION_MODES.FROM_FIRST_TAG,
    preserveTags: true,
    caseSensitive: false,
    allowNested: false,
    tags: DEFAULT_TAGS,
});

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    repairOnMessage: true,
    repairExistingOnChatLoad: false,
    debug: false,
    defaultProfileId: DEFAULT_PROFILE.id,
    profiles: {
        [DEFAULT_PROFILE.id]: DEFAULT_PROFILE,
    },
    presetBindings: {},
});

const VALID_TAG_NAME = /^[A-Za-z][A-Za-z0-9:_-]*$/;

function makeId(prefix = 'profile') {
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function createProfileId() {
    return makeId();
}

export function isValidTagName(name) {
    return VALID_TAG_NAME.test(String(name ?? '').trim());
}

export function normalizeTag(tag) {
    if (typeof tag === 'string') {
        const name = tag.trim();
        return isValidTagName(name) ? { name, preserve: true } : null;
    }

    if (!tag || typeof tag !== 'object') {
        return null;
    }

    const name = String(tag.name ?? '').trim();
    if (!isValidTagName(name)) {
        return null;
    }

    return {
        name,
        preserve: tag.preserve !== false,
    };
}

export function normalizeProfile(profile, fallbackId = createProfileId()) {
    const source = profile && typeof profile === 'object' ? profile : {};
    const tags = Array.isArray(source.tags)
        ? source.tags.map(normalizeTag).filter(Boolean)
        : [];

    const uniqueTags = [];
    const seen = new Set();
    for (const tag of tags) {
        const key = tag.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueTags.push(tag);
    }

    const profileId = String(source.id || fallbackId);
    const extractionMode = EXTRACTION_MODES.FROM_FIRST_TAG;

    return {
        id: profileId,
        name: String(source.name || '未命名配置').trim() || '未命名配置',
        extractionMode,
        preserveTags: source.preserveTags !== false,
        caseSensitive: source.caseSensitive === true,
        allowNested: source.allowNested === true,
        tags: uniqueTags,
    };
}

export function normalizeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const profiles = {};

    const profileEntries = Array.isArray(source.profiles)
        ? source.profiles.map((profile) => [profile?.id, profile])
        : Object.entries(source.profiles || {});

    for (const [id, profile] of profileEntries) {
        const normalized = normalizeProfile(profile, String(id || createProfileId()));
        if (!profiles[normalized.id]) {
            profiles[normalized.id] = normalized;
        }
    }

    if (Object.keys(profiles).length === 0) {
        profiles[DEFAULT_PROFILE.id] = normalizeProfile(DEFAULT_PROFILE, DEFAULT_PROFILE.id);
    }

    const defaultProfileId = profiles[source.defaultProfileId]
        ? source.defaultProfileId
        : Object.keys(profiles)[0];

    const presetBindings = {};
    if (source.presetBindings && typeof source.presetBindings === 'object') {
        for (const [key, profileId] of Object.entries(source.presetBindings)) {
            if (profiles[profileId]) {
                presetBindings[String(key)] = profileId;
            }
        }
    }

    return {
        enabled: source.enabled !== false,
        repairOnMessage: source.repairOnMessage !== false,
        repairExistingOnChatLoad: source.repairExistingOnChatLoad === true,
        debug: source.debug === true,
        defaultProfileId,
        profiles,
        presetBindings,
    };
}

export function getPresetKey(apiId, name) {
    const api = String(apiId ?? '').trim();
    const preset = String(name ?? '').trim();
    return api && preset ? `${api}::${preset}` : '';
}

export function getProfileIdForContext(settings, chatMetadata = {}, presetKey = '') {
    const normalized = normalizeSettings(settings);
    const manualId = String(chatMetadata?.[CHAT_PROFILE_KEY] ?? '');
    if (normalized.profiles[manualId]) {
        return manualId;
    }

    const boundId = normalized.presetBindings[presetKey];
    if (normalized.profiles[boundId]) {
        return boundId;
    }

    return normalized.defaultProfileId;
}

export function hasManualProfileOverride(settings, chatMetadata = {}) {
    const normalized = normalizeSettings(settings);
    return Boolean(normalized.profiles[chatMetadata?.[CHAT_PROFILE_KEY]]);
}

export function cloneSettings(settings) {
    return normalizeSettings(JSON.parse(JSON.stringify(settings)));
}
