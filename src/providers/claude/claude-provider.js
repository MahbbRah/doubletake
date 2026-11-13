import path from 'node:path';
import { BaseProvider } from '../base-provider.js';
import { BrowserLauncher } from '../../core/browser-launcher.js';
import { TemplateEngine } from '../../core/template-engine.js';
import { PayloadBundler } from '../../core/payload-bundler.js';
import { SessionManager } from '../../core/session-manager.js';
import { CLAUDE_URLS, PROVIDERS, DEFAULT_PROVIDER } from '../../config.js';
import { CLAUDE_SELECTORS } from './selectors.js';

export class ClaudeProvider extends BaseProvider {
  constructor(profileManager) {
    super(profileManager);
    this.sessionManager = new SessionManager();
  }

  get providerName() {
    return PROVIDERS.CLAUDE;
  }

  parseRateLimitDate(text) {
    if (!text) return null;
    const now = new Date();

    // Match "until 7 PM", "until tomorrow at 2:10 AM", "until 19:30"
    const timeMatch = text.match(/until\s+(?:tomorrow\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const meridian = timeMatch[3] ? timeMatch[3].toUpperCase() : null;

      if (meridian === 'PM' && hours < 12) hours += 12;
      if (meridian === 'AM' && hours === 12) hours = 0;

      const resetDate = new Date(now);
      resetDate.setHours(hours, minutes, 0, 0);

      // If the time is earlier than now, it means it's tomorrow
      if (resetDate.getTime() <= now.getTime()) {
        resetDate.setDate(resetDate.getDate() + 1);
      }
      return resetDate;
    }

    // Match "in X hours" or "in X minutes"
    const inHoursMatch = text.match(/in\s+(\d+)\s*hour/i);
    if (inHoursMatch) {
      const hours = parseInt(inHoursMatch[1], 10);
      return new Date(now.getTime() + hours * 60 * 60 * 1000);
    }

    const inMinsMatch = text.match(/in\s+(\d+)\s*minute/i);
    if (inMinsMatch) {
      const mins = parseInt(inMinsMatch[1], 10);
      return new Date(now.getTime() + mins * 60 * 1000);
    }

    // Default 3 hours if rate limit message detected without explicit time
    return new Date(now.getTime() + 3 * 60 * 60 * 1000);
  }

  async login(profileId = 'profile-1') {
    const profileDir = this.profileManager.getProfileDir(this.providerName, profileId);
    console.log(`\n🔑 Launching Chrome for profile '${profileId}'...`);
    console.log(`📁 Profile directory: ${profileDir}`);

    const context = await BrowserLauncher.launchProfileContext({
      profileDir,
      interactive: true
    });

    const page = await context.newPage();
    await page.goto(CLAUDE_URLS.HOME, { waitUntil: 'domcontentloaded', timeout: 45000 });

    console.log(`\n👉 Please log into Claude in the opened Chrome window.`);
    console.log(`👉 Complete any 2FA, Google login, or email verification.`);
    console.log(`👉 Once you see the Claude chat interface, return here.`);

    // Wait for user to confirm in terminal
    return new Promise((resolve) => {
      process.stdin.resume();
      process.stdout.write('\nPress ENTER once you have successfully logged in: ');
      process.stdin.once('data', async () => {
        try {
          // Check if composer exists
          const currentUrl = page.url();
          const isLoginPage = currentUrl.includes('/login');

          if (!isLoginPage) {
            this.profileManager.markStatus(this.providerName, profileId, 'ready');
            const storagePath = path.join(profileDir, 'storage_state.json');
            try {
              await context.storageState({ path: storagePath });
              console.log(`💾 Synced portable session credentials to storage_state.json`);
            } catch (syncErr) {
              console.warn(`Could not save storage_state.json:`, syncErr.message);
            }
            console.log(`✅ Profile '${profileId}' authenticated successfully and marked ready.`);
          } else {
            console.log(`⚠️ Browser is still on login page (${currentUrl}). Status set to needs_login.`);
            this.profileManager.markStatus(this.providerName, profileId, 'needs_login');
          }
        } catch (err) {
          console.error(`Error verifying login state:`, err.message);
        } finally {
          await context.close();
          resolve(true);
        }
      });
    });
  }

  async sync(profileId) {
    const profileDir = this.profileManager.getProfileDir(this.providerName, profileId);
    console.log(`🔄 Syncing portable credentials for profile '${profileId}'...`);
    const context = await BrowserLauncher.launchProfileContext({
      profileDir,
      interactive: false
    });
    try {
      const storagePath = path.join(profileDir, 'storage_state.json');
      await context.storageState({ path: storagePath });
      console.log(`✅ Successfully synced credentials to ${storagePath}`);
      return { success: true, storagePath };
    } finally {
      await context.close();
    }
  }

  async findComposer(page) {
    for (const selector of CLAUDE_SELECTORS.COMPOSER) {
      const el = await page.$(selector);
      if (el && (await el.isVisible())) {
        return el;
      }
    }
    return null;
  }

  async checkRateLimit(page) {
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const limitPatterns = [
      /reached your.*message limit/i,
      /out of free messages/i,
      /free message limit/i,
      /message limit until/i,
      /resets at/i,
      /limit until tomorrow/i
    ];

    for (const pattern of limitPatterns) {
      if (pattern.test(bodyText)) {
        const match = bodyText.match(new RegExp(`([^\\n]*?${pattern.source}[^\\n]*)`, 'i'));
        const contextLine = match ? match[1] : '';
        const resetDate = this.parseRateLimitDate(bodyText);
        return { isLimited: true, reason: contextLine.trim() || 'Rate limit detected', resetDate };
      }
    }

    return { isLimited: false };
  }

  async verify(options) {
    const {
      prompt,
      diff = '',
      files = [],
      mode = 'code-review',
      preferredProfile = null,
      sessionId = null,
      threadId = null,
      engine = 'chrome',
      cdpUrl = 'http://127.0.0.1:9222',
      interactive = false,
      waitIfRateLimited = false,
      maxRotationAttempts = 5
    } = options;

    let attempts = 0;
    let lastError = null;

    while (attempts < maxRotationAttempts) {
      attempts++;

      // 1. Select profile
      const selection = this.profileManager.getNextAvailableProfile(this.providerName, preferredProfile);

      if (!selection.available) {
        if (waitIfRateLimited && selection.waitMinutes > 0) {
          console.log(`⏳ All profiles rate limited. Waiting ${selection.waitMinutes} minutes for earliest reset...`);
          await new Promise((r) => setTimeout(r, selection.waitMinutes * 60 * 1000 + 5000));
          continue;
        }

        throw new Error(
          `All profiles for Claude are currently rate-limited. Next profile unlocks in ${selection.waitMinutes} minutes (${selection.earliestReset}).`
        );
      }

      const activeProfile = selection.profile;
      console.log(`\n🚀 [Attempt ${attempts}] Running verification with profile '${activeProfile.id}' (${activeProfile.label})...`);

      const profileDir = this.profileManager.getProfileDir(this.providerName, activeProfile.id);
      let context = null;

      try {
        context = await BrowserLauncher.launchProfileContext({
          profileDir,
          interactive,
          engine,
          cdpUrl
        });

        const page = await context.newPage();

        // 2. Determine target URL & check for existing thread in this profile
        let targetUrl = CLAUDE_URLS.NEW_CHAT;
        let isExistingThread = false;

        if (sessionId) {
          const existingThread = this.sessionManager.getThreadForProfile(sessionId, activeProfile.id);
          if (existingThread) {
            targetUrl = existingThread;
            isExistingThread = true;
            console.log(`🔗 Continuing existing conversation thread on profile '${activeProfile.id}': ${targetUrl}`);
          }
        } else if (threadId) {
          targetUrl = threadId.startsWith('http') ? threadId : `https://claude.ai/chat/${threadId}`;
          isExistingThread = true;
        }

        // Navigate to target URL
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await page.waitForTimeout(2000);
        } catch (navErr) {
          if (isExistingThread) {
            console.warn(`⚠️ Could not reload existing thread (${navErr.message}). Falling back to fresh chat.`);
            targetUrl = CLAUDE_URLS.NEW_CHAT;
            isExistingThread = false;
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
            await page.waitForTimeout(2000);
          } else {
            throw navErr;
          }
        }

        // 3. Check for login redirect
        const currentUrl = page.url();
        if (currentUrl.includes('/login')) {
          console.warn(`⚠️ Profile '${activeProfile.id}' is not logged in.`);
          this.profileManager.markStatus(this.providerName, activeProfile.id, 'needs_login');
          await context.close();
          context = null;
          continue; // rotate to next
        }

        // 4. Check for pre-existing rate limit on page
        const preCheck = await this.checkRateLimit(page);
        if (preCheck.isLimited) {
          console.warn(`⚠️ Profile '${activeProfile.id}' hit rate limit: ${preCheck.reason}`);
          this.profileManager.markRateLimited(this.providerName, activeProfile.id, preCheck.resetDate);
          await context.close();
          context = null;
          continue; // rotate to next
        }

        // 5. Locate composer
        const composer = await this.findComposer(page);
        if (!composer) {
          throw new Error(`Could not find composer input field on Claude.ai.`);
        }

        // 6. Handle file uploads if any large files
        const payloadData = PayloadBundler.preparePayload({ files, diff });
        if (payloadData.filesToUpload.length > 0) {
          const fileInput = await page.$(CLAUDE_SELECTORS.FILE_INPUT);
          if (fileInput) {
            console.log(`📎 Uploading ${payloadData.filesToUpload.length} file attachments...`);
            await fileInput.setInputFiles(payloadData.filesToUpload);
            await page.waitForTimeout(2000);
          }
        }

        // 7. Format verification prompt & inject cross-profile handoff context if new profile in session
        let formattedPrompt = TemplateEngine.formatVerificationPrompt({
          mode,
          prompt,
          diff: payloadData.diff,
          fileContents: payloadData.fileContents
        });

        if (sessionId && !isExistingThread) {
          const handoffPreamble = this.sessionManager.buildHandoffPreamble(sessionId, activeProfile.id);
          if (handoffPreamble) {
            console.log(`🤝 Injected cross-profile handoff context from prior session turns.`);
            formattedPrompt = handoffPreamble + formattedPrompt;
          }
        }

        // 8. Focus and paste text into composer
        const composerLocator = page.locator('[data-testid="chat-input"] p, div.ProseMirror p, div.ProseMirror, textarea').first();
        await composerLocator.click({ force: true });
        await page.waitForTimeout(300);

        let pasteSuccess = false;
        try {
          await context.grantPermissions(['clipboard-read', 'clipboard-write']);
          await page.evaluate((text) => navigator.clipboard.writeText(text), formattedPrompt);
          const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
          await page.keyboard.press(`${modifier}+v`);
          await page.waitForTimeout(600);

          const composerText = await page.evaluate(() => {
            const el = document.querySelector('div.ProseMirror') || document.querySelector('[data-testid="chat-input"]');
            return el ? el.innerText.trim() : '';
          });
          if (composerText.length > 0) {
            pasteSuccess = true;
          }
        } catch (e) {
          console.warn('Clipboard paste failed, trying fallback:', e.message);
        }

        if (!pasteSuccess) {
          try {
            await page.evaluate((text) => {
              const dt = new DataTransfer();
              dt.setData('text/plain', text);
              const el = document.querySelector('div.ProseMirror') || document.querySelector('[data-testid="chat-input"]');
              if (el) {
                el.focus();
                el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
              }
            }, formattedPrompt);
            await page.waitForTimeout(500);
          } catch {
            await page.keyboard.type(formattedPrompt, { delay: 0 });
          }
        }

        // Count assistant messages before sending
        const initialAssistantCount = await page.evaluate(() => {
          return document.querySelectorAll('[data-testid="assistant-message"]').length;
        });

        // 9. Send message
        let sendBtn = null;
        for (let wait = 0; wait < 10; wait++) {
          const btn = page.locator('[data-testid="chat-input-send"], button[aria-label*="Send"]').first();
          if (await btn.isVisible() && await btn.isEnabled()) {
            sendBtn = btn;
            break;
          }
          await page.waitForTimeout(500);
        }

        if (sendBtn) {
          try {
            await sendBtn.click({ force: true });
          } catch {
            await page.evaluate(() => {
              const b = document.querySelector('[data-testid="chat-input-send"], button[aria-label*="Send"]');
              if (b) b.click();
            });
          }
        } else {
          // Fallback to Enter key
          await page.keyboard.press('Enter');
        }

        console.log(`📨 Prompt submitted. Waiting for generation...`);
        await page.waitForTimeout(3000);

        // 10. Check if rate limit triggered immediately upon sending
        const postSendCheck = await this.checkRateLimit(page);
        if (postSendCheck.isLimited) {
          console.warn(`⚠️ Profile '${activeProfile.id}' reached message limit upon send: ${postSendCheck.reason}`);
          this.profileManager.markRateLimited(this.providerName, activeProfile.id, postSendCheck.resetDate);
          await context.close();
          context = null;
          continue; // rotate to next
        }

        // 11. Wait for streaming response to complete
        const responseText = await this.waitForGenerationComplete(page, initialAssistantCount);

        // 12. Parse verdict
        const verdict = TemplateEngine.parseVerdict(responseText);

        // 13. Mark success
        this.profileManager.markSuccess(this.providerName, activeProfile.id);

        const currentChatUrl = page.url();

        // 14. Record session turn for cross-profile continuity
        if (sessionId) {
          this.sessionManager.recordTurn({
            sessionId,
            profileId: activeProfile.id,
            chatUrl: currentChatUrl,
            prompt,
            mode,
            verdict,
            response: responseText
          });
        }

        await context.close();
        context = null;

        return {
          success: true,
          provider: this.providerName,
          profileUsed: activeProfile.id,
          profileLabel: activeProfile.label,
          sessionId: sessionId || null,
          chatUrl: currentChatUrl,
          verdict,
          response: responseText
        };
      } catch (err) {
        lastError = err;
        console.error(`❌ Error during execution with profile '${activeProfile.id}':`, err.message);
        if (context) {
          try {
            await context.close();
          } catch {}
        }
      }
    }

    throw new Error(
      `Verification failed after ${attempts} attempts across profiles. Last error: ${lastError?.message || 'Unknown'}`
    );
  }

  async waitForGenerationComplete(page, initialAssistantCount = 0, maxWaitMs = 180000) {
    const startTime = Date.now();
    let previousText = '';
    let stableCount = 0;

    while (Date.now() - startTime < maxWaitMs) {
      await page.waitForTimeout(2000);

      // Check if rate limited during streaming
      const limitCheck = await this.checkRateLimit(page);
      if (limitCheck.isLimited) {
        throw new Error(`Rate limit hit during generation: ${limitCheck.reason}`);
      }

      // Check if Stop button is still visible
      let isStopVisible = false;
      for (const stopSel of CLAUDE_SELECTORS.STOP_BUTTON) {
        const stopEl = await page.$(stopSel);
        if (stopEl && (await stopEl.isVisible())) {
          isStopVisible = true;
          break;
        }
      }

      // Extract current assistant text from the NEW message
      const result = await page.evaluate((initialCount) => {
        const nodes = document.querySelectorAll(
          '[data-testid="assistant-message"], [data-message-author-role="assistant"], div.font-claude-message'
        );
        if (!nodes || nodes.length === 0) return { hasNew: false, text: '' };
        if (nodes.length <= initialCount) {
          // New message has not appeared yet
          return { hasNew: false, text: '' };
        }
        const lastNode = nodes[nodes.length - 1];
        return { hasNew: true, text: lastNode.innerText || '' };
      }, initialAssistantCount);

      if (result.hasNew && result.text.length > 0) {
        if (result.text === previousText) {
          stableCount++;
          // If text is stable for 3 consecutive checks (6 seconds) and Stop button is not visible, generation is done!
          if (stableCount >= 2 && !isStopVisible) {
            return result.text;
          }
        } else {
          stableCount = 0;
          previousText = result.text;
        }
      }
    }

    if (previousText.length > 0) {
      return previousText;
    }

    throw new Error(`Timed out waiting for Claude response after ${maxWaitMs / 1000} seconds.`);
  }
}
