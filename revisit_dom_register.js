const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Logging setup
function log(msg) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}`;
  console.log(logMsg);
  try {
    fs.appendFileSync('automation_log.txt', logMsg + '\n');
  } catch (e) {
    console.error('Failed to write to log file:', e);
  }
}

// Configuration
const CONFIG = {
  DOCFRIENDS_URL_BASE: 'https://reservation.docfriends.com/',
  REVISIT_URL: 'https://re-visit.kr/dongjedang/hospital/reception/list',
  POLL_INTERVAL_MS: 3000,
  AUTH_FILE: 'auth.json',
  PROCESSED_FILE: 'processed_reservations.json'
};

// Selectors
const SEL_LOGIN_ID = 'input[name="username"]';
const SEL_LOGIN_PW = 'input[name="password"]';
const SEL_BTN_RESERVATION = 'button:has-text("내원등록")';
const SEL_SEARCH_BOX = 'input[placeholder="이름, 전화번호, 차트번호를 입력해주세요."]';
const SEL_AUTOCOMP_1 = '#autocomplete-results > li:nth-child(1)';
const SEL_BTN_PATIENT_INFO = 'button:has-text("환자 정보 입력")';
const SEL_BTN_SAVE = 'button:has-text("등록완료")';
const SEL_INPUT_NAME = 'input[placeholder="이름을 입력해주세요"]';
const SEL_INPUT_PHONE_MID = 'input[name="phone"]';
const SEL_INPUT_PHONE_LAST = 'input[tabindex="5"]';

function getDates() {
  const today = new Date();
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  const fmt = d => d.toISOString().split('T')[0];
  return { today: fmt(today), nextWeek: fmt(nextWeek) };
}

async function safeBringToFront(page, name) {
  try {
    if (page.isClosed()) {
      log(`[ERROR] Page ${name} is closed.`);
      return false;
    }
    await page.bringToFront();
    return true;
  } catch (e) {
    log(`[ERROR] Failed to bring ${name} to front: ${e.message}`);
    return false;
  }
}

async function loginRevisit(page) {
  const isLoginPage = await page.locator('input[name="username"]').isVisible().catch(() => false);
  if (!isLoginPage && page.url().includes('/hospital/')) {
    log('Already logged in to Re-visit (URL and content check passed).');
    return;
  }
  log('Logging into Re-visit...');
  await page.goto('https://re-visit.kr/login');
  await page.fill(SEL_LOGIN_ID, 'dongjedang');
  await page.fill(SEL_LOGIN_PW, 'dongjedang123');
  await page.click('button:has-text("로그인")', { force: true });
  try {
    await page.waitForURL('**/hospital/**', { timeout: 30000 });
    log('Re-visit Login Success');
  } catch (e) {
    log('Re-visit Login Failed or Timeout');
  }
}

async function processReservation(page, reservation) {
  log(`[PROCESS] Processing reservation for: ${reservation.name}`);
  try {
    // [TEST MODE REMOVED] Processing all patients
    // const normalizedPhone = reservation.phone.replace(/\D/g, "");
    // if (reservation.name !== '최장혁' || normalizedPhone !== '01064367706') { ... }
    // Switch to Re-visit and wait for load
    await safeBringToFront(page, 'Re-visit');
    await page.waitForLoadState('networkidle').catch(() => { });

    // Check if logged out
    if (page.url().includes('/login') || await page.locator('input[name="username"]').isVisible().catch(() => false)) {
      log(`[WARNING] Detected logout (URL: ${page.url()}). Re-logging in...`);
      await loginRevisit(page);
    }

    // 1. Click Reservation Reception (내원등록)
    const btn = page.locator(SEL_BTN_RESERVATION);
    log(`[PROCESS] Looking for reservation button: ${SEL_BTN_RESERVATION}`);

    try {
      await btn.waitFor({ state: 'visible', timeout: 5000 });
      await btn.click({ force: true });
      log('[PROCESS] Button visible, clicking...');
    } catch (e) {
      log('[PROCESS] Reservation button not found initially. Checking for logout...');
      if (page.url().includes('/login') || await page.locator('input[name="username"]').isVisible().catch(() => false)) {
        log('[WARNING] Detected logout. Re-logging in...');
        await loginRevisit(page);
        try {
          await btn.waitFor({ state: 'visible', timeout: 10000 });
          await btn.click({ force: true });
          log('[PROCESS] Button visible (after re-login), clicking...');
        } catch (e2) {
          log('[PROCESS ERROR] Reservation button still not found after re-login.');
          return false;
        }
      } else {
        log('[PROCESS ERROR] Reservation button not found and not on login page.');
        return false;
      }
    }
    await page.waitForTimeout(1000);

    // 2. Search Patient
    log(`[PROCESS] Searching patient: ${reservation.phone}`);
    const searchBox = page.locator(SEL_SEARCH_BOX);
    await searchBox.waitFor({ state: 'visible', timeout: 10000 });
    await searchBox.fill(reservation.phone);
    await page.waitForTimeout(1500);

    const firstResult = page.locator(SEL_AUTOCOMP_1);
    const isVisible = await firstResult.isVisible().catch(() => false);
    log(`[DEBUG] Autocomplete visible: ${isVisible}`);

    if (isVisible) {
      await firstResult.click({ force: true });
      log('[PROCESS] Patient found in autocomplete.');
    } else {
      log('[PROCESS] Patient not found, clicking "환자 정보 입력"');
      await page.click(SEL_BTN_PATIENT_INFO, { force: true });
      log('[DEBUG] Clicked Patient Info button');
      await page.waitForTimeout(1000);

      log(`[DEBUG] Filling Name: ${reservation.name}`);
      await page.fill(SEL_INPUT_NAME, reservation.name);

      // Fill Dummy Jumin - always use 000000-0
      log('[DEBUG] Filling Dummy Jumin: 000000-0');
      await page.fill('input[name="dateOfBirth"]', '000000');
      await page.fill('input[name="registerNumber"]', '0');

      // Split phone
      const p = reservation.phone.replace(/\D/g, "");
      let mid = "", last = "";
      if (p.length === 11) { mid = p.slice(3, 7); last = p.slice(7); }
      else if (p.length === 10) { mid = p.slice(3, 6); last = p.slice(6); }

      if (mid) await page.fill(SEL_INPUT_PHONE_MID, mid);
      if (last) await page.fill(SEL_INPUT_PHONE_LAST, last);
    }

    // 4. Select Visit Type (Strictly On-site Reception)
    log(`[PROCESS] Selecting "현장접수" (On-site Reception)...`);
    await page.waitForTimeout(1500);

    const onsiteLabel = page.locator('label:has-text("현장접수")').first();
    try {
      await onsiteLabel.waitFor({ state: 'visible', timeout: 5000 });
      await onsiteLabel.click({ force: true });
      log(`[PROCESS] Clicked "현장접수".`);
    } catch (e) {
      log(`[ERROR] Failed to click "현장접수": ${e.message}`);
      // Try JS click fallback
      if (await onsiteLabel.count() > 0) {
        await onsiteLabel.evaluate(el => el.click());
        log(`[PROCESS] JS Clicked "현장접수".`);
      } else {
        throw new Error('"현장접수" label not found.');
      }
    }

    // SKIP TIME SELECTION COMPLETELY
    log(`[PROCESS] Skipping time selection (Pure Walk-in Mode).`);
    await page.waitForTimeout(1000);

    // 4.5 Handle Treatment Item (진료항목) - Change "침치료" to "예약진료"
    log('[PROCESS] Handling Treatment Item (Changing to "예약진료")...');
    try {
      // 1. Open Dropdown first
      log('[PROCESS] Opening Treatment Item dropdown...');
      const dropdownTrigger = page.locator('div:has-text("진료항목") + span + div').last();
      await dropdownTrigger.click();
      await page.waitForTimeout(1000);

      // 2. Deselect "침치료" (Toggle off)
      // User said: "Clicking the button again removes it"
      // We assume it is selected by default, so we find it in the list and click it.
      log('[PROCESS] Toggling "침치료" OFF...');
      const acupunctureOption = page.locator('div').filter({ hasText: /^침치료$/ }).last();
      if (await acupunctureOption.isVisible()) {
        await acupunctureOption.click();
        log('[PROCESS] Clicked "침치료" to deselect.');
        await page.waitForTimeout(500);
      } else {
        log('[WARN] "침치료" option not visible in dropdown.');
      }

      // 3. Select "예약진료" (Toggle on)
      log('[PROCESS] Selecting "예약진료"...');
      const reservationTreatmentOption = page.locator('div').filter({ hasText: /^예약진료$/ }).last();

      if (await reservationTreatmentOption.isVisible()) {
        await reservationTreatmentOption.click();
        log('[SUCCESS] Selected "예약진료".');
      } else {
        log('[WARN] "예약진료" option not found in list. Trying to type...');
        // If option not found, maybe we need to type it? 
        // But usually it should be there. Let's try typing just in case.
        await page.keyboard.type('예약진료');
        await page.waitForTimeout(1000);
        await page.keyboard.press('Enter');
        log('[PROCESS] Typed "예약진료" and pressed Enter.');
      }

      // Close dropdown if it stays open (clicking outside or label)
      await page.locator('div:has-text("진료항목")').last().click({ force: true });

    } catch (e) {
      log(`[WARN] Failed to change Treatment Item: ${e.message}`);
      // Don't fail the whole process, just log and continue
    }

    await page.waitForTimeout(1000);

    // 5. Save
    log('[PROCESS] Waiting for "등록완료" button...');
    const saveBtn = page.locator(SEL_BTN_SAVE);

    try {
      await saveBtn.waitFor({ state: 'visible', timeout: 5000 });

      // Check if disabled
      if (await saveBtn.isDisabled()) {
        log('[WARNING] "등록완료" button is disabled. Dumping HTML for debug.');
        const html = await page.content();
        fs.writeFileSync(path.join(__dirname, `revisit_save_disabled_${Date.now()}.html`), html);
        await cleanup(page);
        return false;
      }

      await saveBtn.click();
      log('[SUCCESS] Clicked "등록완료". Reservation saved.');

      // Wait for modal to close
      try {
        await page.waitForSelector('div[aria-label="hospital-patient-add-modal"]', { state: 'hidden', timeout: 5000 });
        log('[PROCESS] Modal closed successfully.');
      } catch (e) {
        log('[WARN] Modal did not close immediately after save.');
      }

      return true;

    } catch (e) {
      log(`[ERROR] "등록완료" button issue: ${e.message}`);
      await cleanup(page);
      return false;
    }

  } catch (e) {
    log(`[PROCESS ERROR] Error processing reservation: ${e.message}`);
    const dumpPath = path.join(__dirname, `revisit_process_error_${Date.now()}.html`);
    fs.writeFileSync(dumpPath, await page.content());
    await cleanup(page);
    return false;
  }
}

async function cleanup(page) {
  try {
    log('[CLEANUP] Attempting to close modal...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape'); // Press twice to be sure
    await page.waitForTimeout(500);

    // Navigate back to main page to reset state
    log('[CLEANUP] Navigating to main page to reset state...');
    await page.goto(CONFIG.REVISIT_URL);
    await page.waitForLoadState('networkidle').catch(() => { });
    log('[CLEANUP] Page reset complete.');
  } catch (cleanupError) {
    log(`[CLEANUP ERROR] Failed to cleanup: ${cleanupError.message} `);
  }
}

(async () => {
  if (!fs.existsSync(CONFIG.AUTH_FILE)) {
    log(`Error: ${CONFIG.AUTH_FILE} not found.`);
    process.exit(1);
  }

  log('Starting Automation System (DEBUG MODE)...');
  const browser = await chromium.launch({ headless: false });

  // DocFriends Context
  const contextDoc = await browser.newContext({ storageState: CONFIG.AUTH_FILE });
  const pageDoc = await contextDoc.newPage();

  // Re-visit Context (No auth file initially, login manually)
  const contextRevisit = await browser.newContext();
  const pageRevisit = await contextRevisit.newPage();
  await loginRevisit(pageRevisit);
  await pageRevisit.goto(CONFIG.REVISIT_URL);

  const { today, nextWeek } = getDates();
  const docUrl = `${CONFIG.DOCFRIENDS_URL_BASE}?stateTypes=&reservationDate=dateTime&gte=${today}&lte=${nextWeek}&platformTypes=&productUuids=&bookingName=&bookingNameText=&reservationUuid=`;
  await pageDoc.goto(docUrl);

  const PROCESSED_FILE = path.join(__dirname, 'processed_reservations.json');

  function loadProcessedReservations() {
    try {
      if (fs.existsSync(PROCESSED_FILE)) {
        const data = fs.readFileSync(PROCESSED_FILE, 'utf8');
        return new Set(JSON.parse(data));
      }
    } catch (e) {
      log(`[WARN] Failed to load processed reservations: ${e.message} `);
    }
    return new Set();
  }

  function saveProcessedReservation(key) {
    try {
      const current = loadProcessedReservations();
      current.add(key);
      fs.writeFileSync(PROCESSED_FILE, JSON.stringify([...current], null, 2));
    } catch (e) {
      log(`[ERROR] Failed to save processed reservation: ${e.message} `);
    }
  }

  log('Initialization complete. Polling...');

  while (true) {
    try {
      if (!await safeBringToFront(pageDoc, 'DocFriends')) {
        log('DocFriends page closed. Exiting loop.');
        break;
      }
      await pageDoc.reload();
      await pageDoc.waitForSelector('table.app-table tr.reservation-info-tr', { timeout: 5000 }).catch(() => { });
      await pageDoc.waitForSelector('.skeleton-ui', { state: 'hidden', timeout: 5000 }).catch(() => { });

      const rows = await pageDoc.$$('table.app-table tr.reservation-info-tr');
      log(`Found ${rows.length} rows.`);

      const reservations = [];
      for (const row of rows) {
        try {
          const nameEl = await row.$('td:nth-child(3) p.two-lines-text');
          if (!nameEl) continue;

          const fullText = await nameEl.innerText();
          const phoneEl = await row.$('td:nth-child(3) .subscription');
          const phone = phoneEl ? await phoneEl.innerText() : '';
          let name = fullText.replace(phone, '').trim();

          const timeEl = await row.$('td:nth-child(6) p.one-lines-text');
          const timeStr = timeEl ? await timeEl.innerText() : '';

          // Unified Logic: Treat ALL as WALK_IN (Pure On-site Reception)
          let mode = 'WALK_IN';

          if (name && phone) {
            log(`[PARSE SUCCESS] Found candidate: Name="${name}", Mode="${mode}", Time="${timeStr}"`);
            reservations.push({ name, phone, timeStr, mode });
          }
        } catch (err) {
          log(`[PARSE ERROR] ${err.message}`);
        }
      }

      // Deduplicate reservations based on key
      const uniqueReservations = [];
      const seenKeys = new Set();
      for (const res of reservations) {
        const key = `${res.name}-${res.phone}-${res.timeStr}-${res.mode}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueReservations.push(res);
        }
      }

      if (uniqueReservations.length > 0) {
        log(`Extracted ${uniqueReservations.length} unique reservations. Starting processing...`);

        const processedReservations = loadProcessedReservations();

        try {
          if (!await safeBringToFront(pageRevisit, 'Re-visit')) {
            log('Re-visit page closed. Exiting loop.');
            break;
          }
          log('Switched to Re-visit tab.');

          for (const res of uniqueReservations) {
            const key = `${res.name}-${res.phone}-${res.timeStr}-${res.mode}`;

            if (processedReservations.has(key)) {
              log(`[SKIP] Already processed: ${res.name} (${res.mode})`);
              continue;
            }

            log(`Calling processReservation for ${res.name} (${res.mode})...`);
            const success = await processReservation(pageRevisit, res);

            if (success) {
              saveProcessedReservation(key);
              log(`[SUCCESS] Finished processing ${res.name}. Saved to history.`);
            } else {
              log(`[FAIL] Failed to process ${res.name}. NOT saving to history to allow retry.`);
              // Do NOT save to processed list on failure
            }

            // Small delay between reservations
            await new Promise(r => setTimeout(r, 2000));
          }

          await safeBringToFront(pageDoc, 'DocFriends');
          log('Switched back to DocFriends tab.');
        } catch (err) {
          log(`Error during processing loop: ${err.message}`);
        }
      }

      // Increased from 30s to 60s to prevent race conditions
      await new Promise(r => setTimeout(r, 60000));

    } catch (e) {
      log('Error in loop: ' + e);
      if (e.message.includes('closed')) {
        break;
      }
    }
  }
  await browser.close();
})();
