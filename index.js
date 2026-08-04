import { extension_settings } from '/scripts/extensions.js';
import {
    chat,
    chat_metadata,
    saveChatDebounced,
    saveSettingsDebounced,
    updateMessageBlock,
} from '/script.js';
import { eventSource, event_types } from '/scripts/events.js';
import { repairMessage } from './src/repair.js';
import {
    AUTO_PROFILE_ID,
    CHAT_PROFILE_KEY,
    DEFAULT_PROFILE,
    DEFAULT_SETTINGS,
    EXTENSION_KEY,
    cloneSettings,
    createProfileId,
    getPresetKey,
    getProfileIdForContext,
    hasManualProfileOverride,
    normalizeProfile,
    normalizeSettings,
} from './src/storage.js';

const CONTAINER_ID = 'reasoning_fixer_container';
const PRESET_SELECTORS = {
    openai: '#settings_preset_openai',
    kobold: '#settings_preset',
    novel: '#settings_preset_novel',
    textgenerationwebui: '#settings_preset_textgenerationwebui',
};

const state = {
    settings: normalizeSettings(extension_settings[EXTENSION_KEY] || DEFAULT_SETTINGS),
    editingProfileId: null,
    currentPreset: { apiId: '', name: '' },
    container: null,
};

state.editingProfileId = state.settings.defaultProfileId;
extension_settings[EXTENSION_KEY] = state.settings;

function debug(...args) {
    if (state.settings.debug) {
        console.debug('[Reasoning Fixer]', ...args);
    }
}

function notify(message, type = 'info') {
    if (typeof globalThis.toastr?.[type] === 'function') {
        globalThis.toastr[type](message, 'Reasoning Fixer');
    }
}

function persistSettings() {
    state.settings = normalizeSettings(state.settings);
    extension_settings[EXTENSION_KEY] = state.settings;
    saveSettingsDebounced();
}

function getCurrentPresetContext() {
    const apiId = String(document.querySelector('#main_api')?.value || '').trim();
    const selector = PRESET_SELECTORS[apiId];
    const element = selector ? document.querySelector(selector) : null;
    const selected = element?.selectedOptions?.[0];
    const name = String(selected?.textContent || selected?.value || '').trim();
    return { apiId, name };
}

function refreshPresetContext() {
    state.currentPreset = getCurrentPresetContext();
    if (state.container) {
        refreshUiState();
    }
}

function currentPresetKey() {
    return getPresetKey(state.currentPreset.apiId, state.currentPreset.name);
}

function getActiveProfile() {
    const id = getProfileIdForContext(state.settings, chat_metadata, currentPresetKey());
    return state.settings.profiles[id] || state.settings.profiles[state.settings.defaultProfileId] || DEFAULT_PROFILE;
}

function getManualSelection() {
    return hasManualProfileOverride(state.settings, chat_metadata)
        ? chat_metadata[CHAT_PROFILE_KEY]
        : AUTO_PROFILE_ID;
}

function updateMessageDom(messageId, message) {
    try {
        const element = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (element) {
            updateMessageBlock(messageId, message);
        }
    } catch (error) {
        console.warn('[Reasoning Fixer] Failed to update message DOM', error);
    }
}

function repairMessageById(messageId, source = 'event') {
    if (!state.settings.enabled || !state.settings.repairOnMessage) {
        return false;
    }

    const index = Number(messageId);
    const message = Number.isInteger(index) ? chat[index] : null;
    if (!message) return false;

    const profile = getActiveProfile();
    const result = repairMessage(message, profile);
    if (!result.changed) return false;

    updateMessageDom(index, message);
    saveChatDebounced();
    debug('Repaired message', { index, source, profile: profile.id, moved: result.movedBlocks.map((block) => block.tag) });
    return true;
}

function repairCurrentChat(source = 'manual') {
    if (!state.settings.enabled) {
        notify('扩展已禁用', 'warning');
        return 0;
    }

    const profile = getActiveProfile();
    let count = 0;
    for (let index = 0; index < chat.length; index++) {
        const message = chat[index];
        const result = repairMessage(message, profile);
        if (!result.changed) continue;
        count++;
        updateMessageDom(index, message);
        debug('Repaired chat message', { index, source, profile: profile.id });
    }

    if (count > 0) {
        saveChatDebounced();
        notify(`已修复 ${count} 条消息`, 'success');
    } else if (source === 'manual') {
        notify('当前聊天没有发现可修复内容', 'info');
    }
    return count;
}

function el(tag, props = {}, children = []) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'className') element.className = value;
        else if (key === 'text') element.textContent = value;
        else if (key === 'html') element.innerHTML = value;
        else if (key === 'checked') element.checked = Boolean(value);
        else if (key === 'value') element.value = value ?? '';
        else if (key === 'disabled') element.disabled = Boolean(value);
        else if (key === 'title') element.title = value;
        else element.setAttribute(key, value);
    }
    for (const child of children) {
        if (child) element.append(child);
    }
    return element;
}

function button(label, className = 'menu_button') {
    return el('button', { type: 'button', className, text: label });
}

function makeFieldLabel(label, input) {
    return el('label', { className: 'reasoning-fixer-field' }, [
        el('span', { text: label }),
        input,
    ]);
}

function collapsible(title, defaultOpen, children) {
    const wrapper = el('div', { className: `reasoning-fixer-collapsible${defaultOpen ? ' open' : ''}` });
    const header = el('div', { className: 'reasoning-fixer-collapsible-header' }, [
        el('span', { className: 'reasoning-fixer-collapsible-icon', html: '&#9654;' }),
        el('span', { text: title }),
    ]);
    const body = el('div', { className: 'reasoning-fixer-collapsible-body' }, children);
    header.addEventListener('click', () => wrapper.classList.toggle('open'));
    wrapper.append(header, body);
    return wrapper;
}

function profileOptions(select, includeAuto = false) {
    select.replaceChildren();
    if (includeAuto) {
        select.append(el('option', { value: AUTO_PROFILE_ID, text: '自动：按预设选择' }));
    }
    for (const profile of Object.values(state.settings.profiles)) {
        select.append(el('option', { value: profile.id, text: profile.name }));
    }
}

function renderTagRows(profile, tagsContainer) {
    tagsContainer.replaceChildren();
    for (let index = 0; index < profile.tags.length; index++) {
        const tag = profile.tags[index];
        const nameInput = el('input', { type: 'text', className: 'text_pole reasoning-fixer-tag-name', value: tag.name });
        const preserveInput = el('input', { type: 'checkbox', checked: tag.preserve !== false });
        const removeButton = button('删除', 'menu_button reasoning-fixer-small-button');

        nameInput.addEventListener('input', () => {
            tag.name = nameInput.value.trim();
            persistSettings();
        });
        preserveInput.addEventListener('change', () => {
            tag.preserve = preserveInput.checked;
            persistSettings();
        });
        removeButton.addEventListener('click', () => {
            profile.tags.splice(index, 1);
            persistSettings();
            renderProfileEditor();
        });

        tagsContainer.append(el('div', { className: 'reasoning-fixer-tag-row' }, [
            nameInput,
            el('label', { className: 'reasoning-fixer-inline-check' }, [preserveInput, el('span', { text: '保留标签' })]),
            removeButton,
        ]));
    }
}

function renderProfileEditor() {
    if (!state.container) return;
    const profile = state.settings.profiles[state.editingProfileId] || Object.values(state.settings.profiles)[0];
    if (!profile) return;
    state.editingProfileId = profile.id;

    const nameInput = state.container.querySelector('#reasoning_fixer_profile_name');
    const preserveInput = state.container.querySelector('#reasoning_fixer_preserve_tags');
    const caseInput = state.container.querySelector('#reasoning_fixer_case_sensitive');
    const nestedInput = state.container.querySelector('#reasoning_fixer_allow_nested');
    const tagsContainer = state.container.querySelector('#reasoning_fixer_tags');
    if (!nameInput || !preserveInput || !caseInput || !nestedInput || !tagsContainer) return;

    nameInput.value = profile.name;
    preserveInput.checked = profile.preserveTags;
    caseInput.checked = profile.caseSensitive;
    nestedInput.checked = profile.allowNested;
    renderTagRows(profile, tagsContainer);
}

function refreshUiState() {
    if (!state.container) return;

    const currentSelect = state.container.querySelector('#reasoning_fixer_current_profile');
    const editSelect = state.container.querySelector('#reasoning_fixer_edit_profile');
    const enabledInput = state.container.querySelector('#reasoning_fixer_enabled');
    const repairInput = state.container.querySelector('#reasoning_fixer_repair_on_message');
    const existingInput = state.container.querySelector('#reasoning_fixer_repair_existing');
    const debugInput = state.container.querySelector('#reasoning_fixer_debug');
    const status = state.container.querySelector('#reasoning_fixer_status');
    const bindingStatus = state.container.querySelector('#reasoning_fixer_binding_status');

    if (currentSelect) {
        profileOptions(currentSelect, true);
        currentSelect.value = getManualSelection();
    }
    if (editSelect) {
        profileOptions(editSelect, false);
        editSelect.value = state.editingProfileId;
    }
    if (enabledInput) enabledInput.checked = state.settings.enabled;
    if (repairInput) repairInput.checked = state.settings.repairOnMessage;
    if (existingInput) existingInput.checked = state.settings.repairExistingOnChatLoad;
    if (debugInput) debugInput.checked = state.settings.debug;

    const active = getActiveProfile();
    const preset = currentPresetKey() || '未检测到当前预设';
    if (status) status.textContent = `当前档案：${active.name}；预设：${preset}`;
    if (bindingStatus) {
        const bound = state.settings.presetBindings[currentPresetKey()];
        bindingStatus.textContent = bound && state.settings.profiles[bound]
            ? `当前预设绑定：${state.settings.profiles[bound].name}`
            : '当前预设未绑定档案';
    }
    renderProfileEditor();
}

function createUi() {
    const parent = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!parent || document.querySelector(`#${CONTAINER_ID}`)) return;

    const container = el('div', { id: CONTAINER_ID, className: 'extension_container reasoning-fixer-panel' });
    state.container = container;

    const currentSelect = el('select', { id: 'reasoning_fixer_current_profile', className: 'text_pole' });
    const editSelect = el('select', { id: 'reasoning_fixer_edit_profile', className: 'text_pole' });
    const profileName = el('input', { id: 'reasoning_fixer_profile_name', type: 'text', className: 'text_pole' });
    const preserveTags = el('input', { id: 'reasoning_fixer_preserve_tags', type: 'checkbox' });
    const caseSensitive = el('input', { id: 'reasoning_fixer_case_sensitive', type: 'checkbox' });
    const allowNested = el('input', { id: 'reasoning_fixer_allow_nested', type: 'checkbox' });
    const tags = el('div', { id: 'reasoning_fixer_tags', className: 'reasoning-fixer-tags' });
    const status = el('div', { id: 'reasoning_fixer_status', className: 'reasoning-fixer-status' });
    const bindingStatus = el('div', { id: 'reasoning_fixer_binding_status', className: 'reasoning-fixer-status' });
    const enabled = el('input', { id: 'reasoning_fixer_enabled', type: 'checkbox' });
    const repairOnMessage = el('input', { id: 'reasoning_fixer_repair_on_message', type: 'checkbox' });
    const repairExisting = el('input', { id: 'reasoning_fixer_repair_existing', type: 'checkbox' });
    const debugInput = el('input', { id: 'reasoning_fixer_debug', type: 'checkbox' });

    const addTag = button('添加标签', 'menu_button reasoning-fixer-small-button');
    const saveProfile = button('保存档案');
    const newProfile = button('新建档案');
    const duplicateProfile = button('复制档案');
    const deleteProfile = button('删除档案');
    const bindPreset = button('绑定当前预设');
    const unbindPreset = button('解除当前绑定');
    const repairChatButton = button('修复当前聊天');


    currentSelect.addEventListener('change', () => {
        if (currentSelect.value === AUTO_PROFILE_ID) {
            delete chat_metadata[CHAT_PROFILE_KEY];
        } else {
            chat_metadata[CHAT_PROFILE_KEY] = currentSelect.value;
        }
        saveChatDebounced();
        refreshUiState();
    });
    editSelect.addEventListener('change', () => {
        state.editingProfileId = editSelect.value;
        renderProfileEditor();
    });
    enabled.addEventListener('change', () => { state.settings.enabled = enabled.checked; persistSettings(); });
    repairOnMessage.addEventListener('change', () => { state.settings.repairOnMessage = repairOnMessage.checked; persistSettings(); });
    repairExisting.addEventListener('change', () => { state.settings.repairExistingOnChatLoad = repairExisting.checked; persistSettings(); });
    debugInput.addEventListener('change', () => { state.settings.debug = debugInput.checked; persistSettings(); });
    profileName.addEventListener('input', () => {
        const profile = state.settings.profiles[state.editingProfileId];
        if (!profile) return;
        profile.name = profileName.value;
        persistSettings();
        refreshUiState();
    });
    preserveTags.addEventListener('change', () => {
        const profile = state.settings.profiles[state.editingProfileId];
        if (!profile) return;
        profile.preserveTags = preserveTags.checked;
        persistSettings();
    });
    caseSensitive.addEventListener('change', () => {
        const profile = state.settings.profiles[state.editingProfileId];
        if (!profile) return;
        profile.caseSensitive = caseSensitive.checked;
        persistSettings();
    });
    allowNested.addEventListener('change', () => {
        const profile = state.settings.profiles[state.editingProfileId];
        if (!profile) return;
        profile.allowNested = allowNested.checked;
        persistSettings();
    });
    addTag.addEventListener('click', () => {
        const profile = state.settings.profiles[state.editingProfileId];
        if (!profile) return;
        profile.tags.push({ name: 'new_tag', preserve: true });
        persistSettings();
        renderProfileEditor();
    });
    saveProfile.addEventListener('click', () => {
        state.settings = normalizeSettings(state.settings);
        persistSettings();
        refreshUiState();
        notify('档案已保存', 'success');
    });
    newProfile.addEventListener('click', () => {
        const id = createProfileId();
        state.settings.profiles[id] = normalizeProfile({ id, name: '新档案', tags: [] }, id);
        state.editingProfileId = id;
        persistSettings();
        refreshUiState();
    });
    duplicateProfile.addEventListener('click', () => {
        const source = state.settings.profiles[state.editingProfileId];
        if (!source) return;
        const id = createProfileId();
        state.settings.profiles[id] = normalizeProfile({ ...JSON.parse(JSON.stringify(source)), id, name: `${source.name} 副本` }, id);
        state.editingProfileId = id;
        persistSettings();
        refreshUiState();
    });
    deleteProfile.addEventListener('click', () => {
        if (Object.keys(state.settings.profiles).length <= 1) {
            notify('至少需要保留一个档案', 'warning');
            return;
        }
        const id = state.editingProfileId;
        delete state.settings.profiles[id];
        for (const [key, profileId] of Object.entries(state.settings.presetBindings)) {
            if (profileId === id) delete state.settings.presetBindings[key];
        }
        if (state.settings.defaultProfileId === id) {
            state.settings.defaultProfileId = Object.keys(state.settings.profiles)[0];
        }
        if (chat_metadata[CHAT_PROFILE_KEY] === id) delete chat_metadata[CHAT_PROFILE_KEY];
        state.editingProfileId = state.settings.defaultProfileId;
        persistSettings();
        saveChatDebounced();
        refreshUiState();
    });
    bindPreset.addEventListener('click', () => {
        const key = currentPresetKey();
        if (!key) {
            notify('当前没有可识别的预设', 'warning');
            return;
        }
        state.settings.presetBindings[key] = state.editingProfileId;
        persistSettings();
        refreshUiState();
        notify('已绑定当前预设', 'success');
    });
    unbindPreset.addEventListener('click', () => {
        const key = currentPresetKey();
        if (key) delete state.settings.presetBindings[key];
        persistSettings();
        refreshUiState();
    });
    repairChatButton.addEventListener('click', () => repairCurrentChat('manual'));

    container.append(
        el('div', { className: 'reasoning-fixer-header' }, [
            el('h4', { className: 'reasoning-fixer-title', text: 'Reasoning Fixer' }),
            status,
        ]),
        collapsible('基本设置', true, [
            makeFieldLabel('启用扩展', enabled),
            makeFieldLabel('收到消息时自动修复', repairOnMessage),
            makeFieldLabel('切换聊天时修复全部历史消息', repairExisting),
            makeFieldLabel('调试日志', debugInput),
        ]),
        collapsible('档案管理', true, [
            makeFieldLabel('当前聊天档案', currentSelect),
            el('hr'),
            makeFieldLabel('编辑档案', editSelect),
            makeFieldLabel('档案名称', profileName),
            makeFieldLabel('全局保留标签', preserveTags),
            makeFieldLabel('大小写敏感', caseSensitive),
            makeFieldLabel('允许嵌套标签', allowNested),
            el('div', { className: 'reasoning-fixer-section-label', text: '起始标签' }),
            el('div', {
                className: 'reasoning-fixer-help',
                text: '填写可能出现在正文最前面的最外层标签名；起点之后的内部标签会整体保留。',
            }),
            tags,
            el('div', { className: 'reasoning-fixer-button-row' }, [addTag]),
            el('div', { className: 'reasoning-fixer-button-row' }, [saveProfile, newProfile, duplicateProfile, deleteProfile]),
        ]),
        collapsible('预设绑定', false, [
            bindingStatus,
            el('div', { className: 'reasoning-fixer-button-row' }, [bindPreset, unbindPreset]),
        ]),
        collapsible('手动操作', false, [
            el('div', { className: 'reasoning-fixer-button-row' }, [repairChatButton]),
        ]),
    );

    parent.append(container);
    refreshUiState();
}

function onMessageEvent(messageId, source) {
    repairMessageById(messageId, source);
}

function installEvents() {
    eventSource.makeLast(event_types.MESSAGE_RECEIVED, (messageId, source) => onMessageEvent(messageId, source || 'message_received'));
    eventSource.makeLast(event_types.MESSAGE_UPDATED, (messageId) => onMessageEvent(messageId, 'message_updated'));
    eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => onMessageEvent(messageId, 'character_message_rendered'));
    eventSource.makeLast(event_types.GENERATION_ENDED, () => {
        if (state.settings.enabled && state.settings.repairOnMessage) {
            repairMessageById(chat.length - 1, 'generation_ended');
        }
    });
    eventSource.on(event_types.CHAT_CHANGED, () => {
        refreshPresetContext();
        if (state.settings.enabled && state.settings.repairExistingOnChatLoad) {
            repairCurrentChat('chat_changed');
        }
    });
    eventSource.on(event_types.PRESET_CHANGED, (payload = {}) => {
        if (payload && typeof payload === 'object' && payload.apiId) {
            state.currentPreset = { apiId: payload.apiId, name: payload.name };
        } else {
            refreshPresetContext();
        }
        refreshUiState();
        if (state.settings.enabled && state.settings.repairExistingOnChatLoad) {
            repairCurrentChat('preset_changed');
        }
    });
    eventSource.on(event_types.APP_READY, () => {
        refreshPresetContext();
        refreshUiState();
    });
}

function init() {
    createUi();
    installEvents();
    refreshPresetContext();
    refreshUiState();
    debug('Initialized', { version: '0.3.0' });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
