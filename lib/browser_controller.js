import { spawn } from 'child_process';

let activeBrowser = null;
let activePage = null;
let xvfbProcess = null;
let capturedBearer = null;
let browserEmail = null;
let browserStatus = 'idle'; // idle | starting | running | done | error
let statusMessage = '';

// ── Xvfb Only (No VNC!) ──
function startXvfb() {
    if (xvfbProcess) return;
    console.log('[Xvfb] Starting virtual framebuffer...');
    xvfbProcess = spawn('Xvfb', [':99', '-screen', '0', '400x800x16', '-ac'], { shell: true });
    xvfbProcess.on('exit', () => { xvfbProcess = null; });
    process.env.DISPLAY = ':99';
}

function stopXvfb() {
    if (xvfbProcess) {
        try { xvfbProcess.kill('SIGKILL'); } catch (e) {}
        xvfbProcess = null;
    }
}

// ── Screenshot Endpoint ──
export async function getScreenshot() {
    if (!activePage) return null;
    try {
        return await activePage.screenshot({ type: 'jpeg', quality: 50, fullPage: false });
    } catch (e) {
        console.error('[Screenshot] Failed:', e.message);
        return null;
    }
}

// ── Click Endpoint ──
export async function clickAt(x, y) {
    if (!activePage) throw new Error('No browser running');
    console.log(`[Click] Tapping at (${x}, ${y})`);
    await activePage.mouse.click(x, y);
}

// ── Keyboard Type Endpoint ──
export async function typeText(text) {
    if (!activePage) throw new Error('No browser running');
    console.log(`[Keyboard] Typing ${text.length} chars`);
    await activePage.keyboard.type(text, { delay: 30 });
}

// ── Status ──
export function getBrowserStatus() {
    return { status: browserStatus, message: statusMessage, email: browserEmail };
}

// ── Launch ──
export async function launchInteractiveBrowser(email, db) {
    if (activeBrowser) {
        await activeBrowser.close().catch(() => {});
        activeBrowser = null;
        activePage = null;
    }

    browserEmail = email;
    browserStatus = 'starting';
    statusMessage = 'Booting Xvfb + Chromium...';
    capturedBearer = null;

    // Start virtual display (no VNC!)
    startXvfb();
    await new Promise(r => setTimeout(r, 2000));

    const { chromium } = await import('playwright');

    activeBrowser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--no-first-run',
            '--disable-extensions',
            '--disable-features=Translate,OptimizationHints,MediaRouter',
            '--mute-audio',
            '--window-size=400,800',
            '--display=:99'
        ]
    });

    const context = await activeBrowser.newContext({
        viewport: { width: 400, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    activePage = await context.newPage();

    // Intercept Bearer token from network traffic
    activePage.on('request', request => {
        const url = request.url();
        if (url.includes('/api/v0/users/current') || url.includes('/api/v0/chat/completion')) {
            const auth = request.headers()['authorization'];
            if (auth && auth.startsWith('Bearer ')) {
                capturedBearer = auth.replace('Bearer ', '');
                console.log('[Browser] Successfully extracted Bearer JWT token!');
            }
        }
    });

    await activePage.goto('https://chat.deepseek.com/sign_in');
    browserStatus = 'running';
    statusMessage = 'Browser ready! Use the screenshot panel to login manually.';
    console.log('[Browser] Navigated to login page. Use screenshot panel to interact.');

    // Background watcher: poll for the Bearer token, auto-save when found
    (async () => {
        try {
            let attempts = 0;
            while (!capturedBearer && attempts < 600) { // 10 minutes max
                await new Promise(r => setTimeout(r, 1000));
                attempts++;
            }

            if (!capturedBearer) {
                browserStatus = 'error';
                statusMessage = 'Timed out waiting for login (10 min).';
                throw new Error('Timed out waiting for Bearer token.');
            }

            console.log('[Browser] Login successful. Extracting cookies...');
            statusMessage = 'Token captured! Saving to database...';

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

            const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
            if (existing) {
                db.prepare('UPDATE accounts SET token = ?, active = 1 WHERE id = ?').run(rawToken, existing.id);
                console.log(`[Browser] Token updated for existing account: ${email}`);
            } else {
                db.prepare('INSERT INTO accounts (email, password, token) VALUES (?, ?, ?)').run(email, '', rawToken);
                console.log(`[Browser] Created new database account for: ${email}`);
            }

            browserStatus = 'done';
            statusMessage = `Account ${email} saved successfully!`;

        } catch (e) {
            console.error('[Browser Error]', e.message);
            browserStatus = 'error';
            statusMessage = e.message;
        } finally {
            // Cleanup browser & Xvfb to free all memory
            if (activeBrowser) {
                await activeBrowser.close().catch(() => {});
                activeBrowser = null;
                activePage = null;
            }
            stopXvfb();
        }
    })();

    return { success: true, message: 'Browser launched! Use the screenshot panel to interact.' };
}
