import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const url = 'https://www.applegadgetsbd.com/';
const outputDir = 'c:/Storage/Workspace/Antigravity/www.applegadgetsbd.com_clone';

async function captureHomePage() {
    console.log(`Deep-Cloning Home Page: ${url}`);
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // Set a very realistic User-Agent to avoid the 404
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Wait a bit more for dynamic content
        await new Promise(r => setTimeout(r, 5000));
        
        const content = await page.content();
        
        if (content.includes('Oops! Page Not Found')) {
            console.error('Failed to bypass 404. Site might be blocking automated access or requiring cookies.');
        } else {
            fs.writeFileSync(path.join(outputDir, 'index.html'), content);
            console.log('Successfully captured the REAL home page.');
        }
    } catch (err) {
        console.error('Capture failed:', err.message);
    } finally {
        await browser.close();
    }
}

captureHomePage();
