const puppeteer = require('puppeteer');
(async () => {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
        
        await page.goto('https://flow-venue-service-666422970821.us-central1.run.app', {waitUntil: 'networkidle2'});
        await browser.close();
        console.log("Done");
    } catch(e) {
        console.log("Error:", e);
    }
})();
