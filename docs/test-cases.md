# Manual test cases

Use these cases after copying the extension into `public/scripts/extensions/third-party`.

1. Generate a normal answer with no reasoning. The message must remain unchanged.
2. Put `<think>analysis</think>visible text` in a response. The analysis must appear in Reasoning and the visible text in the main message.
3. Put the following in the reasoning field through a compatible provider:

   ```text
   analysis
   <novel_header>title</novel_header>
   <content>body</content>
   <table_edit>table</table_edit>
   ```

   The three blocks must move to the main message in the same order.
4. Disable tag preservation for `table_edit`. Only its inner text should remain.
5. Send an unclosed `<content>still generating` block. It must not be moved automatically.
6. Generate two swipes and verify that both message text and `swipe_info[*].extra` are repaired.
7. Create two profiles, bind one to the current preset, and confirm that the binding changes when the preset changes.
8. Select a profile manually for the current chat. It must override the preset binding until `自动：按预设选择` is selected again.
9. Press `修复当前聊天` twice. The second run must report no new repairs and must not duplicate content.

