const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();
        await page.goto('file:///C:/Users/joaqu/Desktop/F-Dispatch_Presentacion.html', { waitUntil: 'networkidle0' });
        await page.pdf({
            path: 'C:/Users/joaqu/Desktop/F-Dispatch_Presentacion.pdf',
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
        });
        await browser.close();
        console.log('PDF generado exitosamente');
    } catch (error) {
        console.error('Error:', error);
    }
})();
