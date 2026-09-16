const puppeteer = require('puppeteer');

async function testSaveAndBack() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // Login
  await page.type('#login-email', 'superadmin@botwttsp.com');
  await page.type('#login-password', 'superadmin123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#view-companies:not(.hidden)', { timeout: 5000 });

  // Go to announcements
  await page.click('#btn-open-superadmin-announcements');
  await page.waitForSelector('#view-announcements:not(.hidden)', { timeout: 5000 });

  // Publish announcement
  await page.click('#btn-open-create-announcement');
  await page.waitForSelector('#modal-announcement:not(.hidden)', { timeout: 3000 });
  await page.type('#new-announcement-title', 'Test title');
  await page.type('#new-announcement-message', 'Test message');
  await page.click('#modal-announcement-save');
  await page.waitForSelector('#modal-announcement.hidden', { timeout: 5000 });

  console.log('Announcement published!');

  // Now click back
  console.log('Clicking back button...');
  await page.click('#btn-back-from-announcements');

  await new Promise(r => setTimeout(r, 1000));

  const viewsState = await page.evaluate(() => {
    const views = document.querySelectorAll('.view-content');
    const res = {};
    views.forEach(v => {
      res[v.id] = { hidden: v.classList.contains('hidden'), display: window.getComputedStyle(v).display };
    });
    return {
      activeCompanyId: window.activeCompanyId,
      currentUserRole: window.currentUser ? window.currentUser.role : null,
      views: res
    };
  });

  console.log('State after back:', JSON.stringify(viewsState, null, 2));
  await browser.close();
}

testSaveAndBack().catch(console.error);
