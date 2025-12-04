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
        console.log(`Error: ${CONFIG.AUTH_FILE} not found.`);
        process.exit(1);
    }

    console.log('Starting Page Dump...');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ storageState: CONFIG.AUTH_FILE });
    const page = await context.newPage();

    const { today, nextWeek } = getDates();
    const docUrl = `${CONFIG.DOCFRIENDS_URL_BASE}?stateTypes=&reservationDate=dateTime&gte=${today}&lte=${nextWeek}&platformTypes=&productUuids=&bookingName=&bookingNameText=&reservationUuid=`;

    console.log(`Navigating to: ${docUrl}`);
    await page.goto(docUrl);

    await page.waitForTimeout(5000); // Wait for render

    const html = await page.content();
    fs.writeFileSync('page_dump.html', html);
    console.log('Page dumped to page_dump.html');

    await browser.close();
})();
