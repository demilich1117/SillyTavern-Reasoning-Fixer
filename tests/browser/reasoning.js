import { messageFormatting } from '/script.js';
export class ReasoningHandler {
    updateDom(id) {
        const html = messageFormatting(this.reasoningDisplayText ?? this.reasoning, '', false, false, id, {}, true);
        const container = document.querySelector(`.mes[mesid="${id}"] .mes_reasoning`);
        if (container) container.innerHTML = html;
        return html;
    }
}
