const puppeteer = require('puppeteer');

async function testBulkDelete() {
  console.log('--- STARTING BULK DELETE ANNOUNCEMENTS TEST ---');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // 1. Login as SuperAdmin
  await page.type('#login-email', 'superadmin@botwttsp.com');
  await page.type('#login-password', 'superadmin123');
  await page.click('#login-submit-btn');
  await page.waitForSelector('#view-companies:not(.hidden)', { timeout: 5000 });
  console.log('1. SuperAdmin logged in.');

  // 2. Navigate to Announcements
  await page.click('#btn-open-superadmin-announcements');
  await page.waitForSelector('#view-announcements:not(.hidden)', { timeout: 5000 });
  console.log('2. In Announcements view.');

  // Helper to create an announcement
  async function createAnnouncement(title, msg) {
    await page.evaluate(() => document.getElementById('btn-open-create-announcement').click());
    await page.waitForSelector('#modal-announcement:not(.hidden)', { timeout: 3000 });
    await page.evaluate((t, m) => {
      document.getElementById('new-announcement-title').value = t;
      document.getElementById('new-announcement-message').value = m;
    }, title, msg);
    await page.evaluate(() => document.getElementById('modal-announcement-save').click());
    await page.waitForSelector('#modal-announcement.hidden', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 600));
  }

  const ts = Date.now();
  const titleA = `BulkTest A ${ts}`;
  const titleB = `BulkTest B ${ts}`;
  const titleC = `BulkTest C ${ts}`;

  console.log('3. Creating Announcement A...');
  await createAnnouncement(titleA, 'Mensaje A para prueba de borrado en lote.');
  console.log('3. Creating Announcement B...');
  await createAnnouncement(titleB, 'Mensaje B para prueba de borrado en lote.');
  console.log('3. Creating Announcement C...');
  await createAnnouncement(titleC, 'Mensaje C que debe QUEDAR VIVO.');

  // Verify all 3 exist in table
  const allExist = await page.evaluate((a, b, c) => {
    const text = document.getElementById('announcements-table-body').textContent;
    return text.includes(a) && text.includes(b) && text.includes(c);
  }, titleA, titleB, titleC);
  console.log('4. All 3 announcements exist in table:', allExist);
  if (!allExist) throw new Error('Not all announcements were rendered');

  // Check the checkboxes for titleA and titleB only
  console.log('5. Selecting checkboxes for A and B...');
  await page.evaluate((a, b) => {
    const rows = document.querySelectorAll('#announcements-table-body tr');
    rows.forEach(r => {
      const text = r.textContent;
      if (text.includes(a) || text.includes(b)) {
        const cb = r.querySelector('.announcement-select-checkbox');
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change'));
        }
      }
    });
  }, titleA, titleB);

  await new Promise(r => setTimeout(r, 500));

  // Verify delete button is visible and shows count 2
  const btnState = await page.evaluate(() => {
    const btn = document.getElementById('btn-delete-selected-announcements');
    const count = document.getElementById('selected-announcements-count').textContent;
    return {
      display: window.getComputedStyle(btn).display,
      hidden: btn.classList.contains('hidden'),
      count: parseInt(count, 10)
    };
  });
  console.log('6. Bulk delete button state:', btnState);
  if (btnState.hidden || btnState.count !== 2) {
    throw new Error(`Expected button with count 2, got ${JSON.stringify(btnState)}`);
  }

  // Click delete selected button
  console.log('7. Clicking "Eliminar (2)"...');
  await page.click('#btn-delete-selected-announcements');

  // Wait for custom confirm modal overlay to appear
  await page.waitForSelector('#app-dialog-overlay', { visible: true, timeout: 3000 });
  console.log('8. Custom confirm dialog appeared!');

  // Click confirm button in modal
  await page.click('#app-dialog-confirm');
  await new Promise(r => setTimeout(r, 1000));
  console.log('9. Confirmed deletion in dialog.');

  // Verify that titleA and titleB are GONE, but titleC STILL EXISTS!
  const finalState = await page.evaluate((a, b, c) => {
    const text = document.getElementById('announcements-table-body').textContent;
    return {
      aExists: text.includes(a),
      bExists: text.includes(b),
      cExists: text.includes(c)
    };
  }, titleA, titleB, titleC);
  console.log('10. Final table state:', finalState);

  if (finalState.aExists || finalState.bExists) {
    throw new Error('Announcement A or B was NOT deleted!');
  }
  if (!finalState.cExists) {
    throw new Error('Announcement C was accidentally deleted!');
  }

  console.log('11. SUCCESS! A and B were deleted, and C remained untouched!');

  // Also clean up Announcement C so we leave the DB clean
  await page.evaluate((c) => {
    const rows = document.querySelectorAll('#announcements-table-body tr');
    rows.forEach(r => {
      if (r.textContent.includes(c)) {
        const cb = r.querySelector('.announcement-select-checkbox');
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change'));
        }
      }
    });
  }, titleC);
  await new Promise(r => setTimeout(r, 300));
  await page.click('#btn-delete-selected-announcements');
  await page.waitForSelector('#app-dialog-overlay', { visible: true });
  await page.click('#app-dialog-confirm');
  await new Promise(r => setTimeout(r, 1000));
  console.log('12. Cleaned up C. Test completed perfectly!');

  await browser.close();
}

testBulkDelete().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
