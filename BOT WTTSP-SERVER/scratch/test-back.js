const puppeteer = require('puppeteer');

async function testBack() {
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

  // Click back button
  console.log('Clicking Volver...');
  await page.click('#btn-back-from-announcements');

  const visibleView = await page.evaluate(() => {
    const views = document.querySelectorAll('.view-content');
    for (const v of views) {
      if (!v.classList.contains('hidden')) return v.id;
    }
    return null;
  });
  console.log('Active visible view after back button:', visibleView);

  await browser.close();
}

testBack().catch(console.error);
