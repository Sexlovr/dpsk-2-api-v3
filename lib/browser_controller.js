import { chromium } from 'playwright';

let activeBrowser = null;

export async function launchInteractiveBrowser(email, db) {
    if (activeBrowser) {
        await activeBrowser.close().catch(() => {});
    }

    // Launch Chrome in "headful" mode so it runs on Xvfb and beams over noVNC
    activeBrowser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--window-size=1280,720'
        ]
    });

    const context = await activeBrowser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    let capturedBearer = null;

    // Listen to network requests for the exact moment we get the Bearer token
    page.on('request', request => {
        const url = request.url();
        if (url.includes('/api/v0/users/current') || url.includes('/api/v0/chat/completion')) {
            const auth = request.headers()['authorization'];
            if (auth && auth.startsWith('Bearer ')) {
                capturedBearer = auth.replace('Bearer ', '');
                console.log('[Browser] Successfully extracted Bearer JWT token!');
            }
        }
    });

    // Send the user to the DeepSeek login page
    await page.goto('https://chat.deepseek.com/sign_in');
    console.log('[Browser] Navigated to login page. Waiting for human to solve captcha via VNC...');

    // Wait until we hit the actual chat interface (meaning they passed Cloudflare AND logged in)
    try {
        await page.waitForTimeout(2000);
        await page.waitForURL('https://chat.deepseek.com/*', { timeout: 300000 }); // Wait up to 5 minutes for the human
        console.log('[Browser] Login successful. Extracting cookies...');

        // Wait a small moment to ensure the Bearer token intercepted successfully
        await page.waitForTimeout(3000);

        if (!capturedBearer) {
            throw new Error('Logged in but could not intercept Bearer token. Try again.');
        }

        const cookies = await context.cookies();
        
        const dsSession = cookies.find(c => c.name === 'ds_session_id');
        const wafHash = cookies.find(c => c.name === 'aws-waf-token');
        
        if (!dsSession) throw new Error('Missing ds_session_id cookie');

        let cookieString = `ds_session_id=${dsSession.value}`;
        if (wafHash) cookieString += `; aws-waf-token=${wafHash.value}`;

        const rawToken = JSON.stringify({
            bearer: capturedBearer,
            cookie: cookieString
        });

        // Save successfully extracted account to our SQLite Database natively!
        const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
        if (existing) {
            db.prepare('UPDATE accounts SET token = ?, active = 1 WHERE id = ?').run(rawToken, existing.id);
            console.log(`[Browser] Token updated for existing account: ${email}`);
        } else {
            db.prepare('INSERT INTO accounts (email, password, token) VALUES (?, ?, ?)').run(email, '', rawToken);
            console.log(`[Browser] Created new database account for: ${email}`);
        }

        // Close the browser to free RAM immediately
        await activeBrowser.close();
        activeBrowser = null;
        return { success: true, message: "Browser interaction completed securely!" };

    } catch (e) {
        console.error('[Browser Error]', e);
        if (activeBrowser) {
            await activeBrowser.close();
            activeBrowser = null;
        }
        throw e;
    }
}
