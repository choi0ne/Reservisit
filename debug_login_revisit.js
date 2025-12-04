const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    console.log('Navigating to Re-visit login page...');
    await page.goto('https://re-visit.kr/login');

    console.log('Waiting for page to load...');
    await page.waitForTimeout(5000); // Wait for dynamic content

    const content = await page.content();
    fs.writeFileSync('revisit_login_dump.html', content);
    console.log('Dumped login page to revisit_login_dump.html');

    // Try to find the input fields with current selectors
    const idInput = await page.$('#root div.sc-iUrBwK.dezOTV > div:nth-child(1) input');
    const pwInput = await page.$('#root div.sc-iUrBwK.dezOTV > div:nth-child(2) input');

    if (idInput) console.log('ID Input found with current selector.');
    else console.log('ID Input NOT found with current selector.');

    if (pwInput) console.log('PW Input found with current selector.');
    else console.log('PW Input NOT found with current selector.');

    await browser.close();
})();
