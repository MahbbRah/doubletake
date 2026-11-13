import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { STEALTH_CHROME_ARGS } from '../config.js';

export class BrowserLauncher {
  static async launchProfileContext({
    profileDir,
    interactive = false,
    engine = 'chrome',
    cdpUrl = 'http://127.0.0.1:9222',
    extraArgs = []
  }) {
    if (engine === 'obscura' || engine === 'cdp') {
      let spawnedProc = null;

      // Check if CDP endpoint is already responding
      let isRunning = false;
      try {
        const res = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(800) });
        if (res.ok) isRunning = true;
      } catch {}

      // Auto-spawn native macOS Obscura binary if not running
      if (!isRunning) {
        const nativeBin = path.join(os.homedir(), '.doubletake', 'bin', 'obscura');
        if (fs.existsSync(nativeBin)) {
          console.log(`🚀 Starting native macOS Obscura daemon (${nativeBin})...`);
          spawnedProc = spawn(nativeBin, ['serve', '--stealth', '--port', '9222'], {
            stdio: 'ignore',
            detached: false
          });
          // Wait for socket to bind
          await new Promise((r) => setTimeout(r, 1200));
        }
      }

      console.log(`🔌 Connecting to Obscura/CDP endpoint at ${cdpUrl}...`);
      try {
        const browser = await chromium.connectOverCDP(cdpUrl);
        const storagePath = path.join(profileDir, 'storage_state.json');
        const contextOptions = {
          viewport: { width: 1280, height: 900 }
        };

        if (fs.existsSync(storagePath)) {
          contextOptions.storageState = storagePath;
          console.log(`🔑 Injected synced credentials from storage_state.json into Obscura session.`);
        } else {
          console.log(`ℹ️ No storage_state.json found. Run 'doubletake sync' to export cookies from Chrome.`);
        }

        const context = await browser.newContext(contextOptions);

        if (spawnedProc) {
          const originalClose = context.close.bind(context);
          context.close = async () => {
            try {
              await originalClose();
            } finally {
              try {
                spawnedProc.kill('SIGTERM');
              } catch {}
            }
          };
        }

        return context;
      } catch (err) {
        if (spawnedProc) {
          try {
            spawnedProc.kill();
          } catch {}
        }
        throw new Error(
          `Failed to connect to Obscura at ${cdpUrl}: ${err.message}. Ensure Obscura is available at ~/.doubletake/bin/obscura.`
        );
      }
    }

    // Clean up stale Chrome Singleton locks to prevent launch hang
    try {
      for (const f of fs.readdirSync(profileDir)) {
        if (f.startsWith('Singleton')) {
          fs.unlinkSync(path.join(profileDir, f));
        }
      }
    } catch {}

    const args = [
      ...STEALTH_CHROME_ARGS,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,900',
      ...extraArgs
    ];

    if (!interactive) {
      // Background execution: place window off the primary focus area but keep DOM rendering active
      args.push('--window-position=2500,2500');
    } else {
      args.push('--window-position=100,100');
    }

    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: false, // Essential to bypass Cloudflare Turnstile on claude.ai
      viewport: { width: 1280, height: 900 },
      ignoreDefaultArgs: ['--enable-automation'],
      args,
      permissions: ['clipboard-read', 'clipboard-write']
    });

    // Anti-detection stealth script injection
    await context.addInitScript(() => {
      // Overwrite navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // Pass chrome runtime check
      window.chrome = window.chrome || {
        app: { isInstalled: false },
        webstore: {},
        runtime: {}
      };

      // Mock notification permission
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    });

    return context;
  }
}
