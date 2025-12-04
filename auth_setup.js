const { chromium } = require('playwright');
const fs = require('fs');
const readline = require('readline');

(async () => {
  console.log('Launching browser for authentication setup...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  
  // Open DocFriends
  const page1 = await context.newPage();
  await page1.goto('https://reservation.docfriends.com/');
  console.log('Opened DocFriends. Please log in.');

  // Open Re-visit
  const page2 = await context.newPage();
  await page2.goto('https://re-visit.kr/login');
  console.log('Opened Re-visit. Please log in.');

  console.log('\n==================================================');
  console.log('  [ ACTION REQUIRED ]');
  console.log('  1. Log in to BOTH DocFriends and Re-visit in the opened window.');
  console.log('  2. Ensure you can see the main dashboard/list on both tabs.');
  console.log('  3. Return to this terminal and PRESS ENTER to save the login state.');
  console.log('==================================================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise(resolve => {
    rl.question('Press Enter to save login state and exit...', resolve);
  });

  await context.storageState({ path: 'auth.json' });
  console.log('SUCCESS: Login state saved to auth.json');

  await browser.close();
  rl.close();
})();
