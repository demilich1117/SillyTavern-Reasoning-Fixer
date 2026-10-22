import { createReasoningRenderer, installFormatterProtection } from './display.js';
import { installLegacyProtection } from './legacy-display.js';

export async function connectHost(getSettings) {
    await (globalThis.__TAURITAVERN__?.ready ?? globalThis.__TAURITAVERN_MAIN_READY__);
    const getContext = () => globalThis.SillyTavern.getContext();
    const core = await import('/script.js');
    const { showdown, DOMPurify } = globalThis.SillyTavern.libs;
    const renderReasoning = createReasoningRenderer({ showdown, DOMPurify });
    let protection;
    let protectionError = '';
    try {
        const formatter = getContext().messageFormatter;
        if (formatter?.addHook && formatter.stage?.BEFORE_REGEX && formatter.stage?.AFTER_MARKDOWN) {
            protection = installFormatterProtection(formatter, getSettings, renderReasoning);
        } else {
            const { ReasoningHandler } = await import('/scripts/reasoning.js');
            protection = installLegacyProtection({ core, showdown, ReasoningHandler, getContext, getSettings, renderReasoning });
        }
    } catch (error) {
        protectionError = String(error.message || error);
        console.error('[Reasoning Fixer] Display protection unavailable', error);
    }
    return {
        context: getContext,
        protection,
        protectionError,
        isGenerating: () => {
            const stream = getContext().streamingProcessor;
            return Boolean(core.isGenerating?.() || stream && !stream.isFinished && !stream.isStopped);
        },
        render: (id, message) => core.updateMessageBlock(id, message),
        save: () => getContext().saveChat(),
    };
}
