const puppeteer = require('puppeteer');

async function testCreateCompany() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // Login SuperAdmin
  await page.type('#login-email', 'superadmin@botwttsp.com');
  await page.type('#login-password', 'superadmin123');
  await page.click('#login-submit-btn');
  await page.waitForSelector('#view-companies:not(.hidden)', { timeout: 5000 });

  // Open create company modal
  await page.click('#btn-open-create-company');
  await page.waitForSelector('#modal-company:not(.hidden)', { timeout: 3000 });

  // Fill in
  const compName = 'Empresa Test ' + Date.now();
  const compEmail = 'admin_' + Date.now() + '@test.com';
  await page.type('#new-comp-name', compName);
  await page.type('#new-comp-email', compEmail);
  await page.type('#new-comp-pass', 'password123');

  // Click Guardar Empresa
  await page.click('#modal-comp-save');

  await page.waitForSelector('#modal-company.hidden', { timeout: 5000 });
  console.log('Modal closed successfully after company creation!');

  // Check that new company appears in the directory table
  await page.waitForFunction((expectedName) => {
    return document.body.textContent.includes(expectedName);
  }, { timeout: 5000 }, compName);
  console.log('Verified: Company appears in directory table!');

  await browser.close();
}

testCreateCompany().catch(console.error);
