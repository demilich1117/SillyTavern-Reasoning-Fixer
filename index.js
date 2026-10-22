import { connectHost } from './src/host.js';
import { repairMessage } from './src/repair.js';
import {
    AUTO_PROFILE_ID,
    CHAT_PROFILE_KEY,
    DEFAULT_PROFILE,
    DEFAULT_SETTINGS,
    EXTENSION_KEY,
    createProfileId,
    getPresetKey,
    getProfileIdForContext,
    hasManualProfileOverride,
    normalizeProfile,
    normalizeSettings,
    normalizeTag,
} from './src/storage.js';

const CONTAINER_ID = 'reasoning_fixer_container';
const PRESET_SELECTORS = {
    openai: '#settings_preset_openai',
    kobold: '#settings_preset',
    novel: '#settings_preset_novel',
    textgenerationwebui: '#settings_preset_textgenerationwebui',
};

const state = {
    settings: normalizeSettings(DEFAULT_SETTINGS),
    editingProfileId: null,
    currentPreset: { apiId: '', name: '' },
    container: null,
    pending: new Set(),
    generationChatId: null,
};
let host;
let initPromise;
let surfaceRegistration;
const context = () => globalThis.SillyTavern.getContext();
function saveChat() { host.save().catch(error => { console.error('[Reasoning Fixer] Save failed', error); notify('聊天保存失败，请查看控制台', 'error'); }); }
function saveMetadata() {
    const ctx = context();
    if (ctx.saveMetadataDebounced) ctx.saveMetadataDebounced();
    else Promise.resolve(ctx.saveMetadata()).catch(error => console.error('[Reasoning Fixer] Metadata save failed', error));
}

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
    context().extensionSettings[EXTENSION_KEY] = state.settings;
    context().saveSettingsDebounced();
}

function persistSettingsLite() {
    context().extensionSettings[EXTENSION_KEY] = state.settings;
    context().saveSettingsDebounced();
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
    state.editingProfileId = getActiveProfile().id;
    if (state.container) {
        refreshUiState();
    }
}

function currentPresetKey() {
    return getPresetKey(state.currentPreset.apiId, state.currentPreset.name);
}

function getActiveProfile() {
    const id = getProfileIdForContext(state.settings, context().chatMetadata, currentPresetKey());
    return state.settings.profiles[id] || state.settings.profiles[state.settings.defaultProfileId] || DEFAULT_PROFILE;
}

function getManualSelection() {
    return hasManualProfileOverride(state.settings, context().chatMetadata)
        ? context().chatMetadata[CHAT_PROFILE_KEY]
        : AUTO_PROFILE_ID;
}

function updateMessageDom(messageId, message) {
    try {
        const element = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (element) {
            host.render(messageId, message);
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
    const { chat } = context();
    const message = Number.isInteger(index) ? chat[index] : null;
    if (!message) return false;
    if (host.isGenerating()) {
        state.pending.add(message);
        return false;
    }

    const profile = getActiveProfile();
    const result = repairMessage(message, profile);
    if (!result.changed) return false;

    updateMessageDom(index, message);
    saveChat();
    debug('Repaired message', { index, source, profile: profile.id, moved: result.movedBlocks.map((block) => block.tag) });
    return true;
}

function repairCurrentChat(source = 'manual') {
    if (!state.settings.enabled) {
        notify('扩展已禁用', 'warning');
        return 0;
    }
    if (host.isGenerating()) {
        if (source === 'manual') notify('生成中仅保护显示，请在生成结束后修复历史', 'info');
        return 0;
    }

    const profile = getActiveProfile();
    const { chat } = context();
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
        saveChat();
        notify(`已修复 ${count} 条消息`, 'success');
    } else if (source === 'manual') {
        notify('当前聊天没有发现可修复内容', 'info');
    }
    return count;
}

function refreshRenderedMessages() {
    host.protection?.reset();
    if (surfaceRegistration) surfaceRegistration.refresh().catch(error => console.error('[Reasoning Fixer] Refresh failed', error));
    if (host.isGenerating()) return;
    for (const element of document.querySelectorAll('#chat .mes[mesid]')) {
        if (element.querySelector('.edit_textarea, .reasoning_edit_textarea')) continue;
        const id = Number(element.getAttribute('mesid'));
        const message = context().chat[id];
        if (message) updateMessageDom(id, message);
    }
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
        else if (key === 'hidden') element.hidden = Boolean(value);
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
    const wrapper = el('details', { className: 'reasoning-fixer-collapsible' });
    wrapper.open = defaultOpen;
    const header = el('summary', { className: 'reasoning-fixer-collapsible-header', text: title });
    const body = el('div', { className: 'reasoning-fixer-collapsible-body' }, children);
    wrapper.append(header, body);
    return wrapper;
}

function feature(label, description, input) {
    return el('label', { className: 'reasoning-fixer-feature' }, [
        input,
        el('span', {}, [
            el('strong', { text: label }),
            el('span', { className: 'reasoning-fixer-help', text: description }),
        ]),
    ]);
}

function refreshQuickTags() {
    const input = state.container?.querySelector('#reasoning_fixer_quick_tags');
    if (input && document.activeElement !== input) input.value = getActiveProfile().tags.map(tag => tag.name).join(', ');
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
        const nameInput = el('input', {
            type: 'text',
            className: 'text_pole reasoning-fixer-tag-name',
            value: tag.name,
            placeholder: 'content',
            'aria-label': `起始标签 ${index + 1}`,
        });
        const preserveInput = el('input', { type: 'checkbox', checked: tag.preserve !== false });
        const removeButton = button('删除', 'menu_button reasoning-fixer-small-button');

        nameInput.addEventListener('input', () => {
            const profile = state.settings.profiles[state.editingProfileId];
            if (!profile?.tags?.[index]) return;
            profile.tags[index].name = nameInput.value.trim();
            persistSettingsLite();
        });
        nameInput.addEventListener('blur', () => {
            const profile = state.settings.profiles[state.editingProfileId];
            if (!profile?.tags?.[index]) return;
            const normalized = normalizeTag(profile.tags[index]);
            if (!normalized) return;
            profile.tags[index] = normalized;
            nameInput.value = normalized.name;
            persistSettingsLite();
            refreshQuickTags();
        });
        preserveInput.addEventListener('change', () => {
            const profile = state.settings.profiles[state.editingProfileId];
            if (!profile?.tags?.[index]) return;
            profile.tags[index].preserve = preserveInput.checked;
            persistSettingsLite();
        });
        removeButton.addEventListener('click', () => {
            const profile = state.settings.profiles[state.editingProfileId];
            if (!profile) return;
            profile.tags.splice(index, 1);
            persistSettings();
            renderProfileEditor();
            refreshQuickTags();
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
    const fencedInput = state.container.querySelector('#reasoning_fixer_fenced_output');
    const tagsContainer = state.container.querySelector('#reasoning_fixer_tags');
    if (!nameInput || !preserveInput || !caseInput || !tagsContainer) return;

    nameInput.value = profile.name;
    preserveInput.checked = profile.preserveTags;
    caseInput.checked = profile.caseSensitive;
    if (fencedInput) fencedInput.value = profile.fencedOutput;
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
    const displayInput = state.container.querySelector('#reasoning_fixer_display_protection');
    const modeInput = state.container.querySelector('#reasoning_fixer_display_mode');
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
    if (repairInput) repairInput.disabled = !state.settings.enabled;
    if (existingInput) existingInput.checked = state.settings.repairExistingOnChatLoad;
    if (debugInput) debugInput.checked = state.settings.debug;
    if (displayInput) displayInput.checked = state.settings.displayProtection;
    if (displayInput) displayInput.disabled = !state.settings.enabled || !host.protection;
    if (modeInput) modeInput.value = state.settings.reasoningDisplayMode;

    const active = getActiveProfile();
    const preset = currentPresetKey() || '未检测到当前预设';
    if (status) status.textContent = `当前档案：${active.name}；预设：${preset}${host.protectionError ? `；显示保护不可用：${host.protectionError}` : ''}`;
    const notice = state.container.querySelector('#reasoning_fixer_notice');
    if (notice) {
        notice.hidden = state.settings.enabled && !host.protectionError;
        notice.textContent = !state.settings.enabled ? '扩展已暂停，请在高级设置中启用。' : `显示保护不可用：${host.protectionError}`;
    }
    const tagScope = state.container.querySelector('#reasoning_fixer_tag_scope');
    if (tagScope) {
        tagScope.hidden = Object.keys(state.settings.profiles).length < 2;
        tagScope.textContent = `正在修改「${active.name}」的标签`;
    }
    state.container.querySelector('#reasoning_fixer_repair_chat').disabled = !state.settings.enabled;
    refreshQuickTags();
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

    const drawer = el('div', { id: CONTAINER_ID, className: 'inline-drawer' });
    const drawerToggle = el('div', { className: 'inline-drawer-toggle inline-drawer-header' }, [
        el('b', { text: 'Reasoning Fixer · 思考修复' }),
        el('div', { className: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }),
    ]);
    const drawerContent = el('div', { className: 'inline-drawer-content reasoning-fixer-panel' });
    state.container = drawer;

    const currentSelect = el('select', { id: 'reasoning_fixer_current_profile', className: 'text_pole' });
    const editSelect = el('select', { id: 'reasoning_fixer_edit_profile', className: 'text_pole' });
    const profileName = el('input', { id: 'reasoning_fixer_profile_name', type: 'text', className: 'text_pole' });
    const preserveTags = el('input', { id: 'reasoning_fixer_preserve_tags', type: 'checkbox' });
    const caseSensitive = el('input', { id: 'reasoning_fixer_case_sensitive', type: 'checkbox' });
    const fencedOutput = el('select', { id: 'reasoning_fixer_fenced_output', className: 'text_pole' }, [
        el('option', { value: 'ignore', text: '跳过代码示例（默认）' }),
        el('option', { value: 'unwrap', text: '允许末尾完整代码块作为正文' }),
    ]);
    const tags = el('div', { id: 'reasoning_fixer_tags', className: 'reasoning-fixer-tags' });
    const quickTags = el('input', { id: 'reasoning_fixer_quick_tags', type: 'text', className: 'text_pole', placeholder: 'content', 'aria-describedby': 'reasoning_fixer_tag_help reasoning_fixer_tag_scope' });
    const status = el('div', { id: 'reasoning_fixer_status', className: 'reasoning-fixer-status' });
    const bindingStatus = el('div', { id: 'reasoning_fixer_binding_status', className: 'reasoning-fixer-status' });
    const enabled = el('input', { id: 'reasoning_fixer_enabled', type: 'checkbox' });
    const repairOnMessage = el('input', { id: 'reasoning_fixer_repair_on_message', type: 'checkbox' });
    const repairExisting = el('input', { id: 'reasoning_fixer_repair_existing', type: 'checkbox' });
    const debugInput = el('input', { id: 'reasoning_fixer_debug', type: 'checkbox' });
    const displayProtection = el('input', { id: 'reasoning_fixer_display_protection', type: 'checkbox', disabled: !host.protection });
    const displayMode = el('select', { id: 'reasoning_fixer_display_mode', className: 'text_pole' }, [
        el('option', { value: 'plain', text: '纯文本' }),
        el('option', { value: 'markdown', text: '基础 Markdown（不执行 HTML）' }),
    ]);

    const addTag = button('添加标签', 'menu_button reasoning-fixer-small-button');
    const newProfile = button('新建档案');
    const duplicateProfile = button('复制档案');
    const deleteProfile = button('删除档案');
    const bindPreset = button('绑定当前预设');
    const unbindPreset = button('解除当前绑定');
    const repairChatButton = button('修复当前聊天');
    repairChatButton.id = 'reasoning_fixer_repair_chat';


    currentSelect.addEventListener('change', () => {
        if (currentSelect.value === AUTO_PROFILE_ID) {
            delete context().chatMetadata[CHAT_PROFILE_KEY];
        } else {
            context().chatMetadata[CHAT_PROFILE_KEY] = currentSelect.value;
        }
        saveMetadata();
        state.editingProfileId = getActiveProfile().id;
        refreshUiState();
    });
    editSelect.addEventListener('change', () => {
        state.editingProfileId = editSelect.value;
        renderProfileEditor();
    });
    enabled.addEventListener('change', () => { state.settings.enabled = enabled.checked; persistSettings(); refreshUiState(); refreshRenderedMessages(); });
    repairOnMessage.addEventListener('change', () => { state.settings.repairOnMessage = repairOnMessage.checked; persistSettings(); });
    repairExisting.addEventListener('change', () => { state.settings.repairExistingOnChatLoad = repairExisting.checked; persistSettings(); });
    debugInput.addEventListener('change', () => { state.settings.debug = debugInput.checked; persistSettings(); });
    displayProtection.addEventListener('change', () => { state.settings.displayProtection = displayProtection.checked; persistSettings(); refreshRenderedMessages(); });
    displayMode.addEventListener('change', () => { state.settings.reasoningDisplayMode = displayMode.value; persistSettings(); refreshRenderedMessages(); });
    quickTags.addEventListener('input', () => quickTags.setCustomValidity(''));
    quickTags.addEventListener('change', () => {
        const names = quickTags.value.split(/[,，]/).map(name => name.trim()).filter(Boolean);
        const tags = names.map(normalizeTag);
        if (tags.some(tag => !tag)) {
            quickTags.setCustomValidity('请输入标签名，例如 content；多个标签用逗号隔开。');
            quickTags.reportValidity();
            return;
        }
        const profile = getActiveProfile();
        profile.tags = tags.map(tag => ({ ...tag, preserve: profile.tags.find(old => old.name.toLowerCase() === tag.name.toLowerCase())?.preserve !== false }));
        persistSettings();
        quickTags.value = getActiveProfile().tags.map(tag => tag.name).join(', ');
        renderProfileEditor();
    });
    fencedOutput.addEventListener('change', () => {
        const profile = state.settings.profiles[state.editingProfileId];
        if (profile) { profile.fencedOutput = fencedOutput.value; persistSettings(); }
    });
    profileName.addEventListener('input', () => {
        const profile = state.settings.profiles[state.editingProfileId];
        if (!profile) return;
        profile.name = profileName.value;
        persistSettingsLite();
        const editSelect = state.container?.querySelector('#reasoning_fixer_edit_profile');
        if (editSelect) {
            const option = [...editSelect.options].find(option => option.value === profile.id);
            if (option) option.textContent = profile.name;
        }
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
    addTag.addEventListener('click', () => {
        const profile = state.settings.profiles[state.editingProfileId];
        if (!profile) return;
        profile.tags.push({ name: 'new_tag', preserve: true });
        persistSettings();
        renderProfileEditor();
        refreshQuickTags();
    });
    profileName.addEventListener('change', () => {
        persistSettings();
        refreshUiState();
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
        if (context().chatMetadata[CHAT_PROFILE_KEY] === id) delete context().chatMetadata[CHAT_PROFILE_KEY];
        state.editingProfileId = state.settings.defaultProfileId;
        persistSettings();
        saveMetadata();
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

    drawerContent.append(
        el('div', { className: 'reasoning-fixer-help', text: '把误入思考栏的正文找回来，避免思考格式影响阅读。' }),
        el('div', { id: 'reasoning_fixer_notice', className: 'reasoning-fixer-notice', role: 'status', hidden: true }),
        feature('自动找回正文', '生成结束后，将思考栏中指定标签起的内容移回正文并保存。', repairOnMessage),
        feature('保护思考显示', '隔离思考中的 HTML 和 Markdown，不改写消息原文。', displayProtection),
        el('div', { className: 'reasoning-fixer-quick-tags' }, [
            makeFieldLabel('正文起始标签', quickTags),
            el('div', { id: 'reasoning_fixer_tag_help', className: 'reasoning-fixer-help', text: '填预设使用的正文标签，如 content；多个用逗号隔开。' }),
            el('div', { id: 'reasoning_fixer_tag_scope', className: 'reasoning-fixer-help', hidden: true }),
        ]),
        el('div', { className: 'reasoning-fixer-action' }, [
            repairChatButton,
            el('span', { className: 'reasoning-fixer-help', text: '检查并保存当前聊天的历史消息。' }),
        ]),
        collapsible('高级设置', false, [
            el('div', { className: 'reasoning-fixer-help', text: '修改后自动保存。通常保持默认即可。' }),
            makeFieldLabel('思考显示方式', displayMode),
            makeFieldLabel('切换聊天时自动修复历史消息', repairExisting),
            collapsible('多套规则与标签选项', false, [
                status,
                makeFieldLabel('当前聊天档案', currentSelect),
                el('hr'),
                makeFieldLabel('编辑档案', editSelect),
                makeFieldLabel('档案名称', profileName),
                makeFieldLabel('保留正文标签', preserveTags),
                makeFieldLabel('大小写敏感', caseSensitive),
                makeFieldLabel('代码块中的起始标签', fencedOutput),
                el('div', { className: 'reasoning-fixer-section-label', text: '逐个标签选项' }),
                el('div', {
                    className: 'reasoning-fixer-help',
                    text: '正文内部的嵌套标签会整体保留。只有需要多套规则或逐个去除外层标签时，才需要在这里调整。',
                }),
                tags,
                el('div', { className: 'reasoning-fixer-button-row' }, [addTag]),
                el('div', { className: 'reasoning-fixer-button-row' }, [newProfile, duplicateProfile, deleteProfile]),
                el('hr'),
                bindingStatus,
                el('div', { className: 'reasoning-fixer-button-row' }, [bindPreset, unbindPreset]),
            ]),
            makeFieldLabel('启用扩展', enabled),
            makeFieldLabel('调试日志', debugInput),
        ]),
    );

    drawer.append(drawerToggle, drawerContent);
    parent.append(drawer);
    refreshUiState();
}

function onMessageEvent(messageId, source) {
    repairMessageById(messageId, source);
}

function installEvents() {
    const ctx = context();
    const eventSource = ctx.eventSource;
    const event_types = ctx.eventTypes || ctx.event_types;
    const last = (event, fn) => { if (event) (eventSource.makeLast || eventSource.on).call(eventSource, event, fn); };
    last(event_types.MESSAGE_RECEIVED, (messageId) => onMessageEvent(messageId, 'message_received'));
    last(event_types.MESSAGE_UPDATED, (messageId) => onMessageEvent(messageId, 'message_updated'));
    last(event_types.MESSAGE_SWIPED, (messageId) => onMessageEvent(messageId, 'message_swiped'));
    last(event_types.GENERATION_STARTED, (type, _options, dryRun) => {
        if (!dryRun && type !== 'quiet' && type !== 'impersonate') state.generationChatId = context().chatId;
    });
    last(event_types.GENERATION_ENDED, () => {
        // Core may emit this before its synchronous cleanup has finished.
        const chatId = context().chatId;
        const generationChatId = state.generationChatId;
        state.generationChatId = null;
        queueMicrotask(() => {
            if (context().chatId !== chatId || host.isGenerating()) return;
            if (generationChatId !== null && generationChatId !== chatId) { state.pending.clear(); return; }
            const { chat } = context();
            const pending = [...state.pending];
            state.pending.clear();
            if (!pending.length && generationChatId === chatId && chat.length) pending.push(chat[chat.length - 1]);
            for (const message of pending) {
                const id = chat.indexOf(message);
                if (id >= 0) repairMessageById(id, 'generation_ended');
            }
        });
    });
    eventSource.on(event_types.CHAT_CHANGED, () => {
        state.pending.clear();
        host.protection?.reset();
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
        createUi();
        refreshPresetContext();
        refreshUiState();
    });
}

async function initialize() {
    host = await connectHost(() => state.settings);
    state.settings = normalizeSettings(context().extensionSettings[EXTENSION_KEY] || DEFAULT_SETTINGS);
    state.editingProfileId = state.settings.defaultProfileId;
    context().extensionSettings[EXTENSION_KEY] = state.settings;
    createUi();
    installEvents();
    refreshPresetContext();
    refreshUiState();
    refreshRenderedMessages();
    debug('Initialized', { version: '0.4.0', displayAdapter: host.protection?.mode });
}

function init() {
    return initPromise ||= initialize();
}

// TT requests this before its first bounded projection. No DOM watcher or
// runtime participant is needed: protection runs inside synchronous formatting.
export async function registerChatSurface() {
    await init();
    const surface = globalThis.__TAURITAVERN__?.api?.chatSurface;
    if (!surfaceRegistration && surface?.isManagedOwnershipRequired?.() && surface.registerContentProcessor) {
        surfaceRegistration = surface.registerContentProcessor({
            id: 'reasoning-fixer/display',
            prepare(_context, renderBase) { return renderBase(); },
        });
    }
}

void init().catch(error => { console.error('[Reasoning Fixer] Initialization failed', error); notify('扩展初始化失败，请查看控制台', 'error'); });
