const { chromium } = require('playwright');
const fs = require('fs');

const CONFIG = {
    DOCFRIENDS_URL_BASE: 'https://reservation.docfriends.com/',
    AUTH_FILE: 'auth.json'
};

function getDates() {
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    const fmt = d => d.toISOString().split('T')[0];
    return { today: fmt(today), nextWeek: fmt(nextWeek) };
}

(async () => {
    if (!fs.existsSync(CONFIG.AUTH_FILE)) {
        console.error(`Error: ${CONFIG.AUTH_FILE} not found.`);
        process.exit(1);
    }

    console.log('Starting DocFriends Debug...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: CONFIG.AUTH_FILE });
    const page = await context.newPage();

    const { today, nextWeek } = getDates();
    const docUrl = `${CONFIG.DOCFRIENDS_URL_BASE}?stateTypes=&reservationDate=dateTime&gte=${today}&lte=${nextWeek}&platformTypes=&productUuids=&bookingName=&bookingNameText=&reservationUuid=`;

    console.log(`Navigating to: ${docUrl}`);
    await page.goto(docUrl);

    await page.waitForTimeout(5000); // Wait for render

    // Dump body HTML to find the structure
    // Dump body HTML to find the structure
    const bodyHtml = await page.innerHTML('body');
    fs.writeFileSync('debug.html', bodyHtml, 'utf8');
    console.log('Saved body HTML to debug.html');

    // Try to find something that looks like a row
    // Look for "최장혁" (the name seen in logs) and show surrounding HTML
    const nameIndex = bodyHtml.indexOf('최장혁');
    if (nameIndex !== -1) {
        console.log('--- HTML AROUND "최장혁" ---');
        console.log(bodyHtml.substring(Math.max(0, nameIndex - 500), nameIndex + 500));
        console.log('----------------------------');
    } else {
        console.log('Name "최장혁" not found in HTML.');
    }

    await browser.close();
})();
