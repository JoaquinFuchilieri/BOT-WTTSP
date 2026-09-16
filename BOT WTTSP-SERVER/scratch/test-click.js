const puppeteer = require('puppeteer');

async function run() {
  const browser = await puppeteer.launch({headless: "new"});
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.goto('http://127.0.0.1:3000');
  
  await page.type('#login-email', 'superadmin@botwttsp.com');
  await page.type('#login-password', 'superadmin123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#view-companies', { visible: true, timeout: 5000 });
  
  await page.click('#btn-open-superadmin-announcements');
  await page.waitForSelector('#view-announcements:not(.hidden)', { timeout: 5000 });
  
  await page.click('#btn-open-create-announcement');
  await new Promise(r => setTimeout(r, 1000));
  
  await page.type('#new-announcement-title', 'Test title');
  await page.type('#new-announcement-message', 'Test msg');
  
  const values = await page.evaluate(() => {
    return {
      title: document.getElementById('new-announcement-title').value,
      message: document.getElementById('new-announcement-message').value
    };
  });
  console.log('Values:', values);
  
  await page.evaluate(() => document.getElementById('modal-announcement-save').click());
  
  await new Promise(r => setTimeout(r, 2000));
  const isHiddenAfterSave = await page.$eval('#modal-announcement', el => el.classList.contains('hidden'));
  console.log('Modal is hidden after save:', isHiddenAfterSave);
  
  await browser.close();
}
run();
