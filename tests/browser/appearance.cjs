async (page) => {
    await page.goto('http://127.0.0.1:18764/?host=tt');
    await page.waitForFunction(() => window.harnessReady === true);
    await page.setViewportSize({width:390,height:844});
    const advanced = page.locator('summary').filter({hasText:/^高级设置$/});
    await advanced.focus();
    await page.keyboard.press('Enter');
    if (!await page.getByLabel('思考显示方式').isVisible()) throw new Error('keyboard cannot expand advanced settings');
    await page.keyboard.press('Enter');
    if (await page.getByLabel('思考显示方式').isVisible()) throw new Error('keyboard cannot collapse advanced settings');
    const whiteSpace = await page.locator('.mes_reasoning .custom-reasoning-fixer-plain').evaluate(node => getComputedStyle(node).whiteSpace);
    if (whiteSpace !== 'pre-wrap') throw new Error('host-prefixed reasoning class lost line preservation');
    await page.addStyleTag({content: 'body{background:#f6f3ee;color:#302d28;--SmartThemeBorderColor:#c9c1b6}button,input,select{background:#fffdf8;color:#302d28;border-color:#aaa094}.mes{border-color:#c9c1b6}'});
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('light theme overflow');
    await page.locator('#reasoning_fixer_container').screenshot({path:'output/playwright/tt-panel-light.png'});
    return {keyboard:true,hostPrefixedWhiteSpace:whiteSpace,lightMobileOverflow:false};
}
