const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    console.log('Navigating to Re-visit login page...');
    await page.goto('https://re-visit.kr/login');

    // New selectors
    await page.fill('input[name="username"]', 'dongjedang');
    await page.fill('input[name="password"]', 'dongjedang123');
    await page.click('button:has-text("로그인")');

    try {
        await page.waitForURL('**/hospital/**', { timeout: 15000 });
        console.log('Login Successful! URL: ' + page.url());

        // Check for "내원등록" button
        try {
            await page.waitForSelector('button:has-text("내원등록")', { timeout: 10000 });
            console.log('"내원등록" button found.');
        } catch (e) {
            console.log('"내원등록" button NOT found.');
            // Dump dashboard to check
            const fs = require('fs');
            fs.writeFileSync('revisit_dashboard_dump.html', await page.content());
            console.log('Dumped dashboard to revisit_dashboard_dump.html');
        }

    } catch (e) {
        console.log('Login Failed or Timeout. URL: ' + page.url());
    }

    await browser.close();
})();
