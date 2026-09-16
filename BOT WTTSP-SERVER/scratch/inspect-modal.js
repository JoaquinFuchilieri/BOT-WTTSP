const puppeteer = require('puppeteer');

async function inspectModal() {
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

  // Click "+ Nuevo Anuncio"
  await page.click('#btn-open-create-announcement');

  const modalInfo = await page.evaluate(() => {
    const m = document.getElementById('modal-announcement');
    if (!m) return { found: false };
    const styles = window.getComputedStyle(m);
    const rect = m.getBoundingClientRect();
    
    // Check parent hierarchy
    let curr = m;
    const parents = [];
    while (curr) {
      const cs = window.getComputedStyle(curr);
      parents.push({
        tag: curr.tagName,
        id: curr.id,
        className: curr.className,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        zIndex: cs.zIndex,
        width: cs.width,
        height: cs.height
      });
      curr = curr.parentElement;
    }

    return {
      found: true,
      id: m.id,
      className: m.className,
      rect,
      display: styles.display,
      visibility: styles.visibility,
      opacity: styles.opacity,
      zIndex: styles.zIndex,
      parents
    };
  });

  console.log('Modal Info:', JSON.stringify(modalInfo, null, 2));
  await browser.close();
}

inspectModal().catch(console.error);
