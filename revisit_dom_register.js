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
    if (reservation.name === '변영환') {
      log(`[INFO] Skipping restricted user: ${reservation.name}`);
      return false;
    }
    // Switch to Re-visit and wait for load
    await safeBringToFront(page, 'Re-visit');
    await page.waitForLoadState('networkidle').catch(() => { });

    // Check if logged out
    if (page.url().includes('/login') || await page.locator('input[name="username"]').isVisible().catch(() => false)) {
      log(`[WARNING] Detected logout (URL: ${page.url()}). Re-logging in...`);
      await loginRevisit(page);
    }

    // 1. Click Reservation Reception
    const btn = page.locator(SEL_BTN_RESERVATION);
    log(`[PROCESS] Looking for reservation button: ${SEL_BTN_RESERVATION}`);

    try {
      await btn.waitFor({ state: 'visible', timeout: 5000 });
      await btn.click({ force: true });
      log('[PROCESS] Button visible, clicking...');
    } catch (e) {
      log('[PROCESS] Reservation button not found initially. Checking for logout...');
      // Check if we are actually on the login page (maybe session expired)
      if (page.url().includes('/login') || await page.locator('input[name="username"]').isVisible().catch(() => false)) {
        log('[WARNING] Detected logout. Re-logging in...');
        await loginRevisit(page);
        // Retry finding button
        try {
          await btn.waitFor({ state: 'visible', timeout: 10000 });
          await btn.click({ force: true });
          log('[PROCESS] Button visible (after re-login), clicking...');
        } catch (e2) {
          log('[PROCESS ERROR] Reservation button still not found after re-login.');
          const dumpPath = path.join(__dirname, 'revisit_dump.html');
          fs.writeFileSync(dumpPath, await page.content());
          log(`[PROCESS] Dumped Re-visit HTML to ${dumpPath}`);
          return;
        }
      } else {
        log('[PROCESS ERROR] Reservation button not found and not on login page.');
        const dumpPath = path.join(__dirname, 'revisit_dump.html');
        fs.writeFileSync(dumpPath, await page.content());
        log(`[PROCESS] Dumped Re-visit HTML to ${dumpPath}`);
        return;
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

      if (mid) {
        log(`[DEBUG] Filling MID: ${mid}`);
        await page.fill(SEL_INPUT_PHONE_MID, mid);
      }
      if (last) {
        log(`[DEBUG] Filling LAST: ${last}`);
        await page.fill(SEL_INPUT_PHONE_LAST, last);
      }
    }

    // 4. Select Visit Type
    log(`[PROCESS] Selecting Visit Type...`);

    // Wait a bit for the modal to fully load
    await page.waitForTimeout(1500);

    const SEL_RADIO_RESERVATION = 'label:has-text("예약접수")';
    const SEL_RADIO_ONSITE = 'label:has-text("현장접수")';
    // const SEL_TIME_INPUT_CONTAINER = 'xpath=//div[text()="예약시간"]/ancestor::div[2]/following-sibling::div[1]'; // Failed
    // Dynamic locator strategy defined below

    // Helper to robustly select radio options
    async function robustSelect(text) {
      log(`[PROCESS] Attempting to select "${text}"...`);
      try {
        // 1. Try Label Click
        const label = page.locator(`label:has-text("${text}")`).first();
        if (await label.isVisible()) {
          await label.click({ force: true });
          log(`[PROCESS] Clicked label "${text}"`);
          return true;
        }
      } catch (e) { log(`[DEBUG] Label click failed: ${e.message}`); }

      try {
        // 2. Try JS Click (fallback)
        const label = page.locator(`label:has-text("${text}")`).first();
        if (await label.count() > 0) {
          await label.evaluate(el => el.click());
          log(`[PROCESS] JS Clicked label "${text}"`);
          return true;
        }
      } catch (e) { log(`[DEBUG] JS click failed: ${e.message}`); }

      return false;
    }

    let isReservationMode = false;

    // Attempt to select "Reservation Reception"
    await robustSelect("예약접수");
    await page.waitForTimeout(1000);

    // Check if the time input field appeared
    let timeInputLocator = null;
    try {
      // Robust strategy: Find row with "예약시간" and input placeholder "-"
      const row = page.locator('div').filter({ has: page.locator('div', { hasText: /^예약시간$/ }) }).last();
      // The input container is likely the last div child of this row
      timeInputLocator = row.locator('> div').last();

      await timeInputLocator.waitFor({ state: 'visible', timeout: 5000 });
      isReservationMode = true;
      log(`[SUCCESS] "Reservation Reception" selected. Time input visible.`);
    } catch (e) {
      log(`[ERROR] "Reservation Time" field did not appear.`);
      // DUMP HTML IMMEDIATELY
      const html = await page.content();
      const dumpPath = path.join(__dirname, `revisit_debug_reservation_click_${Date.now()}.html`);
      fs.writeFileSync(dumpPath, html);
      log(`[DEBUG] Dumped HTML to ${dumpPath}`);

      isReservationMode = false;
    }

    if (!isReservationMode) {
      const today = new Date();
      const timeParts = reservation.timeStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
      let isToday = false;
      if (timeParts) {
        const resDate = new Date(timeParts[1], timeParts[2] - 1, timeParts[3]);
        isToday = today.toDateString() === resDate.toDateString();
      }

      if (isToday) {
        log(`[INFO] Reservation is for TODAY. Falling back to "On-site Reception" (현장접수).`);
        await robustSelect("현장접수");
      } else {
        log(`[ERROR] Cannot create FUTURE reservation because "Reservation Reception" is disabled/inaccessible.`);
        throw new Error("Future reservation creation failed: Reservation option disabled.");
      }
    }

    // 5. Date/Time Selection
    // 5. Date/Time Selection
    if (isReservationMode) {
      log(`[PROCESS] Clicking "예약시간" field to open calendar...`);

      try {
        if (timeInputLocator) {
          await timeInputLocator.click({ force: true });
          log(`[PROCESS] Clicked time input.`);
        } else {
          throw new Error("timeInputLocator is null");
        }
      } catch (e) {
        log(`[ERROR] Failed to open calendar: ${e.message}`);
      }

      // Wait for calendar to appear
      await page.waitForTimeout(1000);

      const SEL_CALENDAR_MODAL = '.react-calendar';
      try {
        await page.waitForSelector(SEL_CALENDAR_MODAL, { timeout: 5000 });
        log(`[PROCESS] Calendar modal opened.`);
      } catch (e) {
        log(`[WARN] Calendar modal did not appear. Trying to click again...`);
        await timeInputContainer.click({ force: true });
        await page.waitForSelector(SEL_CALENDAR_MODAL, { timeout: 5000 });
      }

      const timeParts = reservation.timeStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
      if (!timeParts) throw new Error(`Invalid date format: ${reservation.timeStr}`);

      const targetYear = parseInt(timeParts[1], 10);
      const targetMonth = parseInt(timeParts[2], 10);
      const targetDay = parseInt(timeParts[3], 10);

      // Generate possible aria-labels (with and without leading zeros)
      const labelsToTry = [
        `${targetYear}년 ${targetMonth}월 ${targetDay}일`,
        `${targetYear}년 ${String(targetMonth).padStart(2, '0')}월 ${String(targetDay).padStart(2, '0')}일`,
        `${targetYear}년 ${targetMonth}월 ${String(targetDay).padStart(2, '0')}일`,
        `${targetYear}년 ${String(targetMonth).padStart(2, '0')}월 ${targetDay}일`
      ];

      log(`[DEBUG] Trying date labels: ${labelsToTry.join(', ')} `);

      let dateFound = false;

      // Try all aria-label variations
      for (const label of labelsToTry) {
        const dayButton = page.locator(`button.react-calendar__tile:has(abbr[aria-label="${label}"])`);
        if (await dayButton.count() > 0) {
          await dayButton.first().click({ force: true });
          log(`[PROCESS] Selected date using label: ${label}`);
          dateFound = true;
          break;
        }
      }

      // Brute force: If no label matched, iterate through ALL buttons
      if (!dateFound) {
        log(`[WARN] Aria - label search failed.Trying brute force button iteration...`);
        try {
          const allButtons = page.locator('button.react-calendar__tile');
          const count = await allButtons.count();
          log(`[DEBUG] Found ${count} calendar buttons.Looking for day ${targetDay}...`);

          for (let i = 0; i < count; i++) {
            const btn = allButtons.nth(i);

            // Check button text
            const btnText = await btn.innerText();

            // Check aria-label
            const abbr = btn.locator('abbr');
            const ariaLabel = await abbr.getAttribute('aria-label').catch(() => null);

            log(`[DEBUG] Button ${i}: text = "${btnText.trim()}", aria - label="${ariaLabel}"`);

            // Match by day number and check it's not a neighboring month
            if (btnText.trim() === String(targetDay)) {
              const classAttr = await btn.getAttribute('class');
              if (!classAttr.includes('neighboringMonth')) {
                // Also verify it's the right month by checking aria-label
                if (ariaLabel && ariaLabel.includes(`${targetMonth}월`)) {
                  await btn.click({ force: true });
                  log(`[PROCESS] Selected date via brute force: button ${i}, text = "${btnText}", label = "${ariaLabel}"`);
                  dateFound = true;
                  break;
                }
              }
            }
          }
        } catch (e) {
          log(`[ERROR] Brute force iteration failed: ${e.message} `);
        }
      }

      if (!dateFound) {
        log(`[WARN] Date for ${targetYear} - ${targetMonth} - ${targetDay} not found using aria-labels.Trying text content fallback...`);

        // Fallback: Try to find a button with the exact day number
        try {
          const dayButtons = page.locator('button.react-calendar__tile');
          const count = await dayButtons.count();
          for (let i = 0; i < count; i++) {
            const btn = dayButtons.nth(i);
            const text = await btn.innerText();
            if (text.trim() === String(targetDay)) {
              // Check if it's disabled or belongs to another month
              const classAttribute = await btn.getAttribute('class');
              if (!classAttribute.includes('react-calendar__month-view__days__day--neighboringMonth')) {
                await btn.click({ force: true });
                log(`[PROCESS] Selected date using text content: ${targetDay}`);
                dateFound = true;
                break;
              }
            }
          }
        } catch (e) {
          log(`[WARN] Text content fallback failed: ${e.message} `);
        }
      }

      if (!dateFound) {
        log(`[ERROR] Failed to select date ${targetYear} -${targetMonth} -${targetDay} in calendar.`);
        const dumpPath = path.join(__dirname, `revisit_calendar_fail_${Date.now()}.html`);
        fs.writeFileSync(dumpPath, await page.content());
      }

      // Wait a bit for time slots to update after date selection
      await page.waitForTimeout(3000);

      // Try to wait for at least one time slot to appear
      try {
        await page.locator('label, span, div').filter({ hasText: /^\d{1,2}:\d{2}$/ }).first().waitFor({ state: 'visible', timeout: 5000 });
      } catch (e) {
        log(`[WARN] No time slots appeared after waiting.`);
      }

      // DEBUG: Log visible time elements (labels and radio buttons)
      try {
        const timeLabels = page.locator('label, span, div').filter({ hasText: /^\d{1,2}:\d{2}$/ });
        const texts = await timeLabels.allInnerTexts();
        log(`[DEBUG] Visible time elements on page: ${texts.join(', ')} `);
      } catch (e) {
        log(`[DEBUG] Failed to list time elements: ${e.message} `);
      }

      // Calculate target time in 24h format
      let timeStr = reservation.timeStr.split(')')[1].trim();
      let [ampm, time] = timeStr.split(' ');
      let [hour, minute] = time.split(':');
      hour = parseInt(hour);

      if (ampm === '오후' && hour < 12) hour += 12;
      if (ampm === '오전' && hour === 12) hour = 0;

      const formattedTime24 = `${String(hour).padStart(2, '0')}:${minute}`; // "10:00"

      log(`[PROCESS] Target Time: ${formattedTime24} `);

      // Time slots are RADIO BUTTONS (09:00-18:00), not clickable text
      let timeSelected = false;

      // Strategy 1: Click element (label, span, div) containing the time text
      try {
        // Use exact match for text to avoid matching "10:00" in "10:00 AM" if structure differs
        const timeElement = page.locator(`label, span, div`).filter({ hasText: new RegExp(`^${formattedTime24}$`) }).first();
        if (await timeElement.count() > 0) {
          log(`[DEBUG] Found time element: ${await timeElement.evaluate(el => el.outerHTML)}`);

          // Check if disabled
          const isDisabled = await timeElement.evaluate(el => el.hasAttribute('disabled') || el.classList.contains('disabled') || el.parentElement.hasAttribute('disabled'));
          if (isDisabled) {
            log(`[WARN] Time slot ${formattedTime24} appears to be DISABLED/UNAVAILABLE.`);
          }

          await timeElement.click({ force: true });
          log(`[PROCESS] Selected time via element text: ${formattedTime24} `);
          timeSelected = true;
        }
      } catch (e) {
        log(`[DEBUG] Strategy 1(element text) failed: ${e.message} `);
      }

      // Strategy 2: Check radio input with value attribute
      if (!timeSelected) {
        try {
          const timeRadio = page.locator(`input[type="radio"][value="${formattedTime24}"]`).first();
          if (await timeRadio.count() > 0) {
            await timeRadio.check({ force: true });
            log(`[PROCESS] Selected time via radio value: ${formattedTime24} `);
            timeSelected = true;
          }
        } catch (e) {
          log(`[DEBUG] Strategy 2(radio value) failed: ${e.message} `);
        }
      }

      // Strategy 3: Iterate through all labels to find exact match
      if (!timeSelected) {
        try {
          const labels = page.locator('label');
          const count = await labels.count();
          for (let i = 0; i < count; i++) {
            const label = labels.nth(i);
            const text = await label.innerText();
            if (text.trim() === formattedTime24) {
              await label.click({ force: true });
              log(`[PROCESS] Selected time via label iteration: ${formattedTime24} `);
              timeSelected = true;
              break;
            }
          }
        } catch (e) {
          log(`[DEBUG] Strategy 3(label iteration) failed: ${e.message} `);
        }
      }

      if (!timeSelected) {
        log(`[WARN] Time slot ${formattedTime24} not found.`);
        const html = await page.content();
        fs.writeFileSync(path.join(__dirname, `revisit_time_slot_missing_${Date.now()}.html`), html);
      }

      const SEL_BTN_TIME_CONFIRM = 'button:has-text("설정 완료")';
      if (await page.locator(SEL_BTN_TIME_CONFIRM).isVisible()) {
        await page.locator(SEL_BTN_TIME_CONFIRM).click();
        log(`[PROCESS] Confirmed time selection.`);
      }
    }

    const preTimeClickDump = path.join(__dirname, `revisit_pre_time_click_${Date.now()}.html`);
    fs.writeFileSync(preTimeClickDump, await page.content());

    await page.waitForTimeout(1000);

    log('[PROCESS] Waiting for "등록완료" button to be enabled...');
    const saveBtn = page.locator(SEL_BTN_SAVE);
    try {
      await saveBtn.waitFor({ state: 'visible', timeout: 5000 });
      const isDisabled = await saveBtn.isDisabled();
      if (!isDisabled) {
        await saveBtn.click();
        log('[SUCCESS] Clicked "등록완료". Reservation saved.');

        // Wait for the modal to close
        try {
          await page.waitForSelector('div[aria-label="hospital-patient-add-modal"]', { state: 'hidden', timeout: 5000 });
          log('[PROCESS] Modal closed successfully.');
        } catch (e) {
          log('[WARN] Modal did not close immediately after save.');
        }

        return false;
      } else {
        log('[WARNING] "등록완료" button is still disabled.');
        const html = await page.content();
        fs.writeFileSync(path.join(__dirname, `revisit_save_disabled_${Date.now()}.html`), html);
        await cleanup(page);
        return false;
      }
    } catch (e) {
      log(`[ERROR] "등록완료" button not found or error: ${e.message} `);
      await cleanup(page);
      return false;
    }
  } catch (e) {
    log(`[PROCESS ERROR] Error processing reservation: ${e.message} `);
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

          // 확정일시에 시간이 포함된 경우에만 처리 (예: "2023.12.04 (월) 오전 10:30")
          const hasTime = timeStr && /\d{1,2}:\d{2}/.test(timeStr);

          if (name && phone && timeStr) {
            if (hasTime) {
              log(`[PARSE SUCCESS] Found valid reservation: Name = "${name}", Time = "${timeStr}"`);
              reservations.push({ name, phone, timeStr });
            } else {
              log(`[PARSE SKIP] Skipping ${name}: No valid time found in "${timeStr}"(Date only or Unconfirmed)`);
            }
          }
        } catch (err) {
          log(`[PARSE ERROR] ${err.message} `);
        }
      }

      // Deduplicate reservations based on key
      const uniqueReservations = [];
      const seenKeys = new Set();
      for (const res of reservations) {
        const key = `${res.name} -${res.phone} -${res.timeStr} `;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueReservations.push(res);
        }
      }

      if (uniqueReservations.length > 0) {
        log(`Extracted ${uniqueReservations.length} unique reservations.Starting processing...`);

        const processedReservations = loadProcessedReservations();

        try {
          if (!await safeBringToFront(pageRevisit, 'Re-visit')) {
            log('Re-visit page closed. Exiting loop.');
            break;
          }
          log('Switched to Re-visit tab.');

          for (const res of uniqueReservations) {
            const key = `${res.name} -${res.phone} -${res.timeStr} `;

            if (processedReservations.has(key)) {
              log(`[SKIP] Already processed: ${res.name} `);
              continue;
            }

            log(`Calling processReservation for ${res.name}...`);
            const success = await processReservation(pageRevisit, res);

            if (success) {
              saveProcessedReservation(key);
              log(`[SUCCESS] Finished processing ${res.name}. Saved to history.`);
            } else {
              log(`[FAIL] Failed to process ${res.name}.`);
              // Save to processed list anyway to prevent infinite retries
              // This prevents the same failed reservation from blocking the queue
              saveProcessedReservation(key);
              log(`[INFO] Marked ${res.name} as processed to prevent retry loop.`);
            }

            // Small delay between reservations
            await new Promise(r => setTimeout(r, 2000));
          }

          await safeBringToFront(pageDoc, 'DocFriends');
          log('Switched back to DocFriends tab.');
        } catch (err) {
          log(`Error during processing loop: ${err.message} `);
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
