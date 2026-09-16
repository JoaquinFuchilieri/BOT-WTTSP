const puppeteer = require('puppeteer');

async function debug() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER PAGEERROR:', err.message, err.stack));

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // Login
  await page.type('#login-email', 'superadmin@botwttsp.com');
  await page.type('#login-password', 'superadmin123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#view-companies', { visible: true, timeout: 5000 });

  // Go to announcements
  await page.click('#btn-open-superadmin-announcements');
  await page.waitForSelector('#view-announcements:not(.hidden)', { timeout: 5000 });

  // Check state of modal before click
  const modalBefore = await page.evaluate(() => {
    const m = document.getElementById('modal-announcement');
    return m ? { exists: true, className: m.className, style: m.getAttribute('style') } : { exists: false };
  });
  console.log('Modal before click:', modalBefore);

  // Click the button
  console.log('Clicking #btn-open-create-announcement...');
  await page.click('#btn-open-create-announcement');

  await new Promise(r => setTimeout(r, 500));

  // Check state of modal after click
  const modalAfter = await page.evaluate(() => {
    const m = document.getElementById('modal-announcement');
    const computed = window.getComputedStyle(m);
    return m ? {
      exists: true,
      className: m.className,
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      zIndex: computed.zIndex
    } : { exists: false };
  });
  console.log('Modal after click:', modalAfter);

  await page.screenshot({ path: 'scratch/modal-opened-check.png' });
  await browser.close();
}

debug().catch(console.error);
