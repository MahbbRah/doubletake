import path from 'node:path';
import os from 'node:os';

export const APP_NAME = 'doubletake';
export const BASE_DIR = path.join(os.homedir(), '.doubletake');
export const PROFILES_CONFIG_PATH = path.join(BASE_DIR, 'profiles.json');
export const PROFILES_DATA_DIR = path.join(BASE_DIR, 'profiles');
export const SESSIONS_CONFIG_PATH = path.join(BASE_DIR, 'sessions.json');

export const PROVIDERS = {
  CLAUDE: 'claude',
  CHATGPT: 'chatgpt'
};

export const DEFAULT_PROVIDER = PROVIDERS.CLAUDE;

export const ENGINES = {
  CHROME: 'chrome',
  OBSCURA: 'obscura',
  CDP: 'cdp'
};

export const DEFAULT_ENGINE = ENGINES.CHROME;
export const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

export const CLAUDE_URLS = {
  HOME: 'https://claude.ai',
  NEW_CHAT: 'https://claude.ai/new',
  LOGIN: 'https://claude.ai/login'
};

export const VERIFICATION_MODES = {
  CODE_REVIEW: 'code-review',
  BUG_CHECK: 'bug-check',
  SECURITY_AUDIT: 'security-audit',
  GENERAL_VERIFICATION: 'general-verification',
  CUSTOM: 'custom'
};

export const CHROME_PATHS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
};

export const STEALTH_CHROME_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=IsolateOrigins,site-per-process',
  '--flag-switches-begin',
  '--flag-switches-end'
];
