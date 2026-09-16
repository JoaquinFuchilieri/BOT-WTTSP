const puppeteer = require('puppeteer');

async function run() {
  const browser = await puppeteer.launch({headless: "new"});
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3000');
  
  const hasFn = await page.evaluate(() => {
    return typeof window.openCreateAnnouncementModal === 'function';
  });
  
  console.log('Function exists:', hasFn);
  await browser.close();
}
run();
