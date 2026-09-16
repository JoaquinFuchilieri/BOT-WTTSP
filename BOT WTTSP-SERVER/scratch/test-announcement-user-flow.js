const puppeteer = require('puppeteer');

async function testFullAnnouncementFlow() {
  console.log('Testing full announcement creation by real user clicks...');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // Login
  await page.type('#login-email', 'superadmin@botwttsp.com');
  await page.type('#login-password', 'superadmin123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#view-companies', { visible: true, timeout: 5000 });

  // Go to announcements
  await page.click('#btn-open-superadmin-announcements');
  await page.waitForSelector('#view-announcements:not(.hidden)', { timeout: 5000 });

  // Click the "+ Nuevo Anuncio" button
  console.log('Clicking "+ Nuevo Anuncio"...');
  await page.click('#btn-open-create-announcement');
  await page.waitForSelector('#modal-announcement:not(.hidden)', { timeout: 3000 });
  console.log('Modal opened successfully!');

  // Fill in announcement
  const title = 'Anuncio Test Directo ' + Date.now();
  await page.type('#new-announcement-title', title);
  await page.type('#new-announcement-message', 'Mensaje de prueba para verificar el guardado.');

  // Click "Publicar Anuncio"
  console.log('Clicking "Publicar Anuncio"...');
  await page.click('#modal-announcement-save');

  // Wait for modal to close
  await page.waitForSelector('#modal-announcement.hidden', { timeout: 5000 });
  console.log('Modal closed after publish!');

  // Verify it appears in table and count occurrences (MUST BE EXACTLY 1)
  await new Promise(r => setTimeout(r, 1000));
  const count = await page.evaluate((expectedTitle) => {
    const rows = document.querySelectorAll('#announcements-table-body tr');
    let matches = 0;
    for (const r of rows) {
      if (r.textContent.includes(expectedTitle)) matches++;
    }
    return matches;
  }, title);
  console.log(`Announcement count with title "${title}":`, count);
  if (count !== 1) {
    throw new Error(`DUPLICATE DETECTED! Expected 1 announcement, but found ${count}`);
  }
  console.log('Verified: Exactly 1 announcement created (NO DUPLICATE)!');

  // Take screenshot as artifact proof
  await page.screenshot({ path: 'C:/Users/joaqu/.gemini/antigravity/brain/1cba97fb-a8a9-4801-a618-c30af8a22ad1/.tempmediaStorage/announcement_created_success.png' });
  console.log('Screenshot saved!');

  await browser.close();
  console.log('TEST COMPLETE: SUCCESS!');
}

testFullAnnouncementFlow().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
