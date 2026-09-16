const puppeteer = require('puppeteer');

async function inspectSaveButton() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // Login
  await page.type('#login-email', 'superadmin@botwttsp.com');
  await page.type('#login-password', 'superadmin123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#view-companies', { visible: true, timeout: 5000 });

  // Go to announcements
  await page.click('#btn-open-superadmin-announcements');
  await page.waitForSelector('#view-announcements:not(.hidden)', { timeout: 5000 });

  // Open modal
  await page.click('#btn-open-create-announcement');
  await page.waitForSelector('#modal-announcement:not(.hidden)', { timeout: 3000 });

  const btnInfo = await page.evaluate(() => {
    const btn = document.getElementById('modal-announcement-save');
    if (!btn) return { exists: false };
    const rect = btn.getBoundingClientRect();
    const elAtPoint = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      exists: true,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      offsetParent: btn.offsetParent ? btn.offsetParent.tagName + '#' + btn.offsetParent.id : null,
      elementFromPoint: elAtPoint ? elAtPoint.tagName + '#' + elAtPoint.id + '.' + elAtPoint.className : null,
      visible: !!(btn.offsetWidth || btn.offsetHeight || btn.getClientRects().length),
      disabled: btn.disabled,
      outerHTML: btn.outerHTML
    };
  });
  console.log('Button info:', JSON.stringify(btnInfo, null, 2));

  await browser.close();
}

inspectSaveButton().catch(console.error);
