# Architecture

## Runtime integration

The extension is a browser-side SillyTavern extension. It subscribes to the shared `eventSource` with `makeLast` so the built-in reasoning parser runs first:

- `MESSAGE_RECEIVED`
- `MESSAGE_UPDATED`
- `CHARACTER_MESSAGE_RENDERED`
- `GENERATION_ENDED`
- `CHAT_CHANGED`
- `PRESET_CHANGED`

Message data is updated through the public exports from `/script.js`:

- `chat`
- `chat_metadata`
- `updateMessageBlock`
- `saveChatDebounced`
- `saveSettingsDebounced`

No server route or additional listening port is required.

## Repair order

1. Select the effective profile using the current chat override, preset binding, or global default.
2. If the visible message has a conventional leading `<think>`, `<thinking>`, `<reasoning>`, or `<analysis>` envelope, split it into `message.extra.reasoning` and `message.mes`.
3. Apply the profile extraction mode to `message.extra.reasoning`:
   - `from_first_tag`: find the first configured opening tag and move its complete suffix;
   - `configured_blocks`: scan for complete configured blocks.
4. Move the extracted content to `message.mes`. In first-tag mode the suffix is kept intact, including unknown nested tags.
5. Remove empty reasoning metadata and synchronize the selected swipe.
6. Re-render the existing DOM node and debounce chat persistence.

Unclosed configured blocks are left untouched in exact mode. First-tag mode deliberately moves the suffix even when an inner tag is incomplete, because the configured outer tag marks the beginning of the final output.
