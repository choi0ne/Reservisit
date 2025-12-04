const { chromium } = require('playwright');
const fs = require('fs');

const CONFIG = {
    REVISIT_URL: 'https://re-visit.kr/dongjedang/hospital/reception/list',
    AUTH_FILE: 'auth.json'
};

(async () => {
    if (!fs.existsSync(CONFIG.AUTH_FILE)) {
        console.error(`Error: ${CONFIG.AUTH_FILE} not found.`);
        process.exit(1);
    }

    console.log('Starting Debug Script...');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ storageState: CONFIG.AUTH_FILE });
    const page = await context.newPage();

    console.log(`Navigating to Re-visit: ${CONFIG.REVISIT_URL}`);
    await page.goto(CONFIG.REVISIT_URL);

    // Wait for load
    await page.waitForTimeout(3000);

    // Click "내원등록"
    const btnVisit = page.locator('button:has-text("내원등록")').first();
    if (await btnVisit.isVisible()) {
        await btnVisit.click();
        console.log('Clicked "내원등록"');

        // Wait for modal
        await page.waitForTimeout(2000);

        console.log('\n--- BUTTONS FOUND ON PAGE (AFTER CLICK) ---');
        const buttons = await page.locator('button').allInnerTexts();
        buttons.forEach((txt, i) => console.log(`[Button ${i}]: ${txt.replace(/\n/g, ' ')}`));

        console.log('\n--- DIALOG/MODAL TEXT CONTENT ---');
        // Try to find a dialog or the last opened container
        const dialogs = await page.locator('div[role="dialog"], div[class*="modal"], div[class*="popup"]').allInnerTexts();
        dialogs.forEach((txt, i) => console.log(`[Dialog ${i}]:\n${txt}\n----------------`));

    } else {
        console.error('Button "내원등록" not found!');
    }

    console.log('\nDebug complete. Keeping browser open for 30 seconds...');
    await page.waitForTimeout(30000);
    await browser.close();
})();
