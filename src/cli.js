import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { ProfileManager } from './core/profile-manager.js';
import { getProvider } from './providers/index.js';
import { DEFAULT_PROVIDER, VERIFICATION_MODES } from './config.js';

export function createCli() {
  const program = new Command();
  const profileManager = new ProfileManager();

  program
    .name('doubletake')
    .description('DoubleTake — Multi-profile browser automation CLI for verifying software with Claude.ai web')
    .version('1.0.0');

  // Command: login
  program
    .command('login')
    .description('Open browser for a profile to log into Claude.ai interactively')
    .option('-p, --profile <id>', 'Profile ID to log into', 'profile-1')
    .option('--provider <name>', 'Provider to log into', DEFAULT_PROVIDER)
    .option('--label <label>', 'Optional display label for this profile')
    .action(async (options) => {
      const providerName = options.provider || DEFAULT_PROVIDER;
      const profileId = options.profile;

      // Ensure profile exists in config
      let prof = profileManager.getProfile(providerName, profileId);
      if (!prof) {
        prof = profileManager.addProfile(providerName, profileId, options.label);
      } else if (options.label) {
        prof.label = options.label;
        profileManager.saveConfig();
      }

      const provider = getProvider(providerName, profileManager);
      await provider.login(profileId);
      process.exit(0);
    });

  // Command: open
  program
    .command('open')
    .description('Open a visible browser window for a profile to inspect its active Claude session')
    .option('-p, --profile <id>', 'Profile ID to open', 'profile-2')
    .option('--provider <name>', 'Provider name', DEFAULT_PROVIDER)
    .action(async (options) => {
      const providerName = options.provider || DEFAULT_PROVIDER;
      const profileDir = profileManager.getProfileDir(providerName, options.profile);
      console.log(`\n🖥️ Opening visible browser for profile '${options.profile}'...`);
      const { BrowserLauncher } = await import('./core/browser-launcher.js');
      const context = await BrowserLauncher.launchProfileContext({
        profileDir,
        interactive: true
      });
      const page = await context.newPage();
      await page.goto('https://claude.ai', { waitUntil: 'domcontentloaded' });
      console.log(`👉 Browser is open at https://claude.ai. Inspect your session.`);
      process.stdin.resume();
      process.stdout.write('Press ENTER when you are done to close the browser: ');
      process.stdin.once('data', async () => {
        await context.close();
        process.exit(0);
      });
    });

  // Command: preview
  program
    .command('preview')
    .description('Capture a visual screenshot of Claude.ai rendered by Obscura or Chrome and open it')
    .option('-p, --profile <id>', 'Profile ID to preview', 'profile-2')
    .option('--engine <engine>', 'Browser engine (obscura or chrome)', 'obscura')
    .option('--provider <name>', 'Provider name', DEFAULT_PROVIDER)
    .action(async (options) => {
      const providerName = options.provider || DEFAULT_PROVIDER;
      const profileDir = profileManager.getProfileDir(providerName, options.profile);
      console.log(`\n📸 Capturing visual preview using engine '${options.engine.toUpperCase()}' for profile '${options.profile}'...`);
      const { BrowserLauncher } = await import('./core/browser-launcher.js');
      const { exec } = await import('node:child_process');
      const os = await import('node:os');
      const context = await BrowserLauncher.launchProfileContext({
        profileDir,
        engine: options.engine,
        interactive: false
      });
      try {
        const page = await context.newPage();
        await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(3000);
        const previewPath = path.join(os.tmpdir(), `doubletake-preview-${options.engine}.png`);
        await page.screenshot({ path: previewPath });
        console.log(`✅ Screenshot saved to: ${previewPath}`);
        exec(`open "${previewPath}"`);
        console.log(`🖼️ Opened visual screenshot in macOS Preview.app!`);
      } catch (err) {
        console.error(`❌ Preview failed:`, err.message);
      } finally {
        await context.close();
        process.exit(0);
      }
    });

  // Command: status
  program
    .command('status')
    .description('View status, rate limits, and cooldowns for all profiles')
    .option('--provider <name>', 'Provider name', DEFAULT_PROVIDER)
    .action((options) => {
      const providerName = options.provider || DEFAULT_PROVIDER;
      const profiles = profileManager.listProfiles(providerName);

      console.log(`\n======================================================`);
      console.log(` 🌐 DoubleTake Profiles Status [${providerName.toUpperCase()}]`);
      console.log(`======================================================`);

      if (profiles.length === 0) {
        console.log(`No profiles configured yet. Run 'cross-verifier login --profile=profile-1' to begin.`);
      } else {
        for (const p of profiles) {
          const statusIcon =
            p.status === 'ready'
              ? '✅'
              : p.status === 'rate_limited'
                ? '⏳'
                : p.status === 'needs_login'
                  ? '🔑'
                  : '❓';

          console.log(`\n${statusIcon} ID: ${p.id} (${p.label || 'No label'})`);
          console.log(`   Status:       ${p.status.toUpperCase()}`);
          if (p.rate_limited_until) {
            const resetDate = new Date(p.rate_limited_until);
            const remainingMins = Math.max(0, Math.ceil((resetDate.getTime() - Date.now()) / (1000 * 60)));
            console.log(`   Cooldown:     Rate limited until ${resetDate.toLocaleTimeString()} (~${remainingMins} mins left)`);
          }
          console.log(`   Last Used:    ${p.last_used_at ? new Date(p.last_used_at).toLocaleString() : 'Never'}`);
        }
      }
      console.log(`\n======================================================\n`);
    });

  // Command: profiles
  program
    .command('profiles')
    .description('Manage browser profiles')
    .option('--add <id>', 'Add a new profile ID')
    .option('--label <label>', 'Display label for the profile')
    .option('--remove <id>', 'Remove a profile ID from active configuration')
    .option('--delete-data', 'Also delete the profile browser cache/data directory on disk', false)
    .option('--provider <name>', 'Provider name', DEFAULT_PROVIDER)
    .action((options) => {
      const providerName = options.provider || DEFAULT_PROVIDER;

      if (options.add) {
        const added = profileManager.addProfile(providerName, options.add, options.label);
        console.log(`✅ Added profile '${added.id}' (${added.label})`);
      } else if (options.remove) {
        const removed = profileManager.removeProfile(providerName, options.remove, options.deleteData);
        if (removed) {
          console.log(`🗑️ Removed profile '${options.remove}'${options.deleteData ? ' and deleted its browser data directory' : ''}.`);
        } else {
          console.log(`⚠️ Profile '${options.remove}' not found.`);
        }
      } else {
        const profiles = profileManager.listProfiles(providerName);
        console.log(JSON.stringify(profiles, null, 2));
      }
    });

  // Command: sync
  program
    .command('sync')
    .description('Export and sync profile credentials to portable storage_state.json (for Obscura/CDP)')
    .option('-p, --profile <id>', 'Profile ID to sync', 'profile-2')
    .option('--provider <name>', 'Provider name', DEFAULT_PROVIDER)
    .action(async (options) => {
      const providerName = options.provider || DEFAULT_PROVIDER;
      const provider = getProvider(providerName, profileManager);
      try {
        await provider.sync(options.profile);
        process.exit(0);
      } catch (err) {
        console.error(`❌ Sync failed:`, err.message);
        process.exit(1);
      }
    });

  // Command: verify
  program
    .command('verify')
    .description('Run verification prompt with automated rotation')
    .argument('<prompt>', 'Verification instructions or query')
    .option('-m, --mode <mode>', 'Verification mode (code-review, bug-check, security-audit, general-verification, custom)', VERIFICATION_MODES.CODE_REVIEW)
    .option('-f, --files <paths>', 'Comma-separated file paths to review')
    .option('-d, --diff <diffPathOrText>', 'Git diff or patch file path')
    .option('-p, --profile <id>', 'Preferred profile ID')
    .option('--provider <name>', 'Provider name', DEFAULT_PROVIDER)
    .option('--wait', 'Wait if all profiles are rate limited', false)
    .option('-s, --session <id>', 'Session or conversation ID to preserve ongoing context')
    .option('-t, --thread <id_or_url>', 'Specific Claude chat URL or thread ID to post directly into')
    .option('--engine <engine>', 'Browser engine to use (chrome, obscura, cdp)', 'chrome')
    .option('--cdp-url <url>', 'CDP websocket or HTTP URL for Obscura/CDP', 'http://127.0.0.1:9222')
    .option('--show-browser', 'Display the browser window rather than background', false)
    .action(async (promptText, options) => {
      const providerName = options.provider || DEFAULT_PROVIDER;
      const provider = getProvider(providerName, profileManager);

      let files = [];
      if (options.files) {
        files = options.files.split(',').map((f) => f.trim()).filter(Boolean);
      }

      let diff = '';
      if (options.diff) {
        if (fs.existsSync(options.diff)) {
          diff = fs.readFileSync(options.diff, 'utf-8');
        } else {
          diff = options.diff;
        }
      }

      console.log(`\n🔍 Starting DoubleTake Verification...`);
      console.log(`Engine:   ${options.engine.toUpperCase()}`);
      console.log(`Mode:     ${options.mode}`);
      if (options.session) console.log(`Session:  ${options.session}`);
      if (options.thread) console.log(`Thread:   ${options.thread}`);
      console.log(`Files:    ${files.length > 0 ? files.join(', ') : 'None'}`);
      console.log(`Diff:     ${diff ? `${diff.length} characters` : 'None'}`);

      try {
        const result = await provider.verify({
          prompt: promptText,
          diff,
          files,
          mode: options.mode,
          preferredProfile: options.profile,
          sessionId: options.session || null,
          threadId: options.thread || null,
          engine: options.engine,
          cdpUrl: options.cdpUrl,
          waitIfRateLimited: options.wait,
          interactive: options.showBrowser
        });

        console.log(`\n======================================================`);
        console.log(` 📋 DOUBLETAKE VERIFICATION RESULT (Profile: ${result.profileUsed})`);
        console.log(`======================================================`);
        console.log(`Verdict:     ${result.verdict.status}`);
        console.log(`Confidence:  ${result.verdict.confidence}`);
        console.log(`Summary:     ${result.verdict.summary}`);
        console.log(`Chat URL:    ${result.chatUrl}`);
        if (result.verdict.copyable_commands && result.verdict.copyable_commands.length > 0) {
          console.log(`\n💻 Copyable Commands:`);
          for (const cmd of result.verdict.copyable_commands) {
            console.log(`   $ ${cmd}`);
          }
        }
        console.log(`------------------------------------------------------\n`);
        console.log(result.response);
        console.log(`\n======================================================\n`);
        process.exit(0);
      } catch (err) {
        console.error(`\n❌ Verification failed: ${err.message}`);
        process.exit(1);
      }
    });

  return program;
}
