async (page) => {
    const results = [];
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    for (const kind of ['st', 'tt']) {
        await page.goto(`http://127.0.0.1:18764/?host=${kind}`);
        await page.waitForFunction(() => window.harnessReady === true);
        if (await page.locator('#reasoning_fixer_container input[type=checkbox]:visible').count() !== 2) throw new Error('basic panel must expose only the two feature switches');
        if (!await page.getByRole('button', {name:'修复当前聊天',exact:true}).isVisible()) throw new Error('manual repair is hidden');
        await page.getByLabel('正文起始标签', {exact:true}).fill('<answer>');
        await page.getByLabel('正文起始标签', {exact:true}).press('Tab');
        await page.evaluate(() => {
            const settings = testApi.settings.reasoningFixer;
            if (settings.profiles[settings.defaultProfileId].tags[0].name !== 'answer') throw new Error('quick tag did not save');
        });
        await page.getByLabel('正文起始标签', {exact:true}).fill('content');
        await page.getByLabel('正文起始标签', {exact:true}).press('Tab');
        await page.getByText('高级设置', {exact:true}).click();
        await page.getByLabel('思考显示方式').selectOption('markdown');
        if (await page.locator('.mes_reasoning strong').textContent() !== '强调') throw new Error(`${kind}: markdown control failed`);
        await page.getByLabel('思考显示方式').selectOption('plain');
        const lifecycle = await page.evaluate(async () => {
            const api = testApi;
            const original = { mes: '', extra: { reasoning: '思考：使用 `<content>` 标签。\n<content>正式正文</content>' } };
            const before = api.saves;
            await api.start(original);
            if (api.saves !== before || api.chat[0].mes !== '') throw new Error('wrote during streaming');
            await api.finish();
            if (api.saves !== before + 1 || api.chat[0].mes !== '<content>正式正文</content>') throw new Error('final repair failed');
            if (api.chat[0].extra.reasoning !== '思考：使用 `<content>` 标签。') throw new Error('example was split');
            await api.events.emit('MESSAGE_UPDATED', 0);
            await api.finish();
            if (api.saves !== before + 1) throw new Error('duplicate save');
            await api.start({ mes: '<think><b>思考', extra: {} });
            if (!document.querySelector('.custom-reasoning-fixer-isolated[open]')) throw new Error('partial thought is not protected');
            if (api.chat[0].mes !== '<think><b>思考') throw new Error('display mutated raw text');
            await api.changeChat();
            api.setMessage({ mes: '', extra: { reasoning: '<content>另一个聊天</content>' } });
            await api.finish();
            if (api.chat[0].mes !== '') throw new Error('old generation modified new chat');
            api.setMessage({ mes: '<think>仅显示隔离</think>**正文**', extra: {} });
            api.remount();
            if (!document.querySelector('.custom-reasoning-fixer-isolated') || document.querySelector('.mes_text strong')?.textContent !== '正文') throw new Error('remount lost protection');
            if (Object.values(api.listeners).some(count => count !== 1)) throw new Error('duplicate listeners');
            return { saves: api.saves, registrations: api.registrations, listeners: api.listeners };
        });
        await page.getByLabel('自动找回正文').uncheck();
        await page.evaluate(async () => {
            testApi.setMessage({mes:'',extra:{reasoning:'**强调** <content>不应移动</content>'}});
            await testApi.events.emit('MESSAGE_UPDATED',0);
            if (testApi.chat[0].mes !== '' || !document.querySelector('.mes_reasoning .custom-reasoning-fixer-plain')) throw new Error('display-only failed');
        });
        await page.getByRole('button', {name:'修复当前聊天',exact:true}).click();
        await page.evaluate(() => { if (testApi.chat[0].mes !== '<content>不应移动</content>') throw new Error('manual repair failed with automatic repair off'); });
        await page.getByLabel('保护思考显示').uncheck();
        if (await page.locator('.custom-reasoning-fixer-plain').count()) throw new Error(`${kind}: disable failed`);
        await page.getByLabel('保护思考显示').check();
        await page.getByLabel('自动找回正文').check();
        await page.getByText('多套规则与标签选项', {exact:true}).click();
        await page.getByLabel('代码块中的起始标签').selectOption('unwrap');
        await page.evaluate(async () => {
            testApi.setMessage({mes:'',extra:{reasoning:'分析\n```html\n<content>代码块正文</content>\n```'}});
            await testApi.events.emit('MESSAGE_UPDATED',0);
            if (testApi.chat[0].mes !== '<content>代码块正文</content>') throw new Error('fenced output setting failed');
        });
        await page.setViewportSize({width:390,height:844});
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        if (overflow) throw new Error(`${kind}: mobile horizontal overflow`);
        await page.getByText('多套规则与标签选项', {exact:true}).click();
        await page.getByLabel('启用扩展', {exact:true}).uncheck();
        if (!await page.getByLabel('自动找回正文').isDisabled() || !await page.locator('#reasoning_fixer_notice').isVisible()) throw new Error('paused extension is misleading');
        await page.getByLabel('启用扩展', {exact:true}).check();
        await page.getByText('高级设置', {exact:true}).click();
        await page.evaluate(() => {
            testApi.setMessage({mes:'<content>正文保持正常显示。</content>',extra:{reasoning:'思考里讨论 `<content>` 标签。\n**强调** 和 <style>p{display:none}</style> 留在思考区。'}});
            document.querySelector('#notice').textContent = '';
        });
        await page.screenshot({path:`output/playwright/${kind}-mobile.png`,fullPage:true});
        await page.locator('#reasoning_fixer_container').screenshot({path:`output/playwright/${kind}-panel.png`});
        await page.setViewportSize({width:1280,height:1000});
        await page.screenshot({path:`output/playwright/${kind}-desktop.png`,fullPage:true});
        results.push({kind, ...lifecycle, mobileOverflow:overflow});
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return {passed:true,results,pageErrors:errors};
}
