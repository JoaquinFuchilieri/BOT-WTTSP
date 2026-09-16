const puppeteer = require('puppeteer');

async function test404() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('response', resp => {
    if (resp.status() >= 400) {
      console.log('FAILED RESOURCE:', resp.status(), resp.url());
    }
  });

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });
  await browser.close();
}

test404().catch(console.error);
