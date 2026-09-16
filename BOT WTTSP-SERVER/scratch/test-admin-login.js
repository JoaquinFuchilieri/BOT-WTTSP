const puppeteer = require('puppeteer');

async function testAdminLogin() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  await page.type('#login-email', 'admin@demo.com');
  await page.type('#login-password', 'admin123');
  await page.click('button[type="submit"]');

  await new Promise(r => setTimeout(r, 2000));
  const result = await page.evaluate(() => {
    const err = document.getElementById('login-error');
    const app = document.getElementById('app-section');
    return {
      errorText: err ? err.textContent : null,
      errorHidden: err ? err.classList.contains('hidden') : null,
      appHidden: app ? app.classList.contains('hidden') : null
    };
  });
  console.log('Login result:', result);
  await browser.close();
}

testAdminLogin().catch(console.error);
