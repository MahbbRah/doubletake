import fs from 'node:fs';
import path from 'node:path';
import {
  BASE_DIR,
  PROFILES_CONFIG_PATH,
  PROFILES_DATA_DIR,
  DEFAULT_PROVIDER
} from '../config.js';

export class ProfileManager {
  constructor(configPath = PROFILES_CONFIG_PATH, dataDir = PROFILES_DATA_DIR) {
    this.configPath = configPath;
    this.dataDir = dataDir;
    this.baseDir = path.dirname(configPath);
    this.ensureDirectories();
    this.config = this.loadConfig();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  getProfileDir(provider = DEFAULT_PROVIDER, profileId = 'profile-1') {
    const dir = path.join(this.dataDir, provider, profileId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  loadConfig() {
    if (!fs.existsSync(this.configPath)) {
      const initialConfig = {
        claude: {
          active_profile: 'profile-1',
          profiles: {
            'profile-1': {
              id: 'profile-1',
              label: 'Default Profile 1',
              status: 'unknown',
              rate_limited_until: null,
              last_used_at: null,
              created_at: new Date().toISOString()
            }
          }
        },
        chatgpt: {
          active_profile: 'profile-1',
          profiles: {}
        }
      };
      this.saveConfig(initialConfig);
      return initialConfig;
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      return data;
    } catch {
      return { claude: { active_profile: 'profile-1', profiles: {} } };
    }
  }

  saveConfig(config = this.config) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  cleanExpiredLimits(provider = DEFAULT_PROVIDER) {
    const now = Date.now();
    const providerConfig = this.config[provider];
    if (!providerConfig || !providerConfig.profiles) return;

    let changed = false;
    for (const [id, prof] of Object.entries(providerConfig.profiles)) {
      if (prof.rate_limited_until) {
        const resetTime = new Date(prof.rate_limited_until).getTime();
        if (now >= resetTime) {
          prof.status = 'ready';
          prof.rate_limited_until = null;
          changed = true;
        }
      }
    }

    if (changed) {
      this.saveConfig();
    }
  }

  listProfiles(provider = DEFAULT_PROVIDER) {
    this.cleanExpiredLimits(provider);
    const providerConfig = this.config[provider] || { profiles: {} };
    return Object.values(providerConfig.profiles);
  }

  getProfile(provider = DEFAULT_PROVIDER, profileId) {
    this.cleanExpiredLimits(provider);
    return this.config[provider]?.profiles[profileId] || null;
  }

  addProfile(provider = DEFAULT_PROVIDER, profileId, label) {
    if (!this.config[provider]) {
      this.config[provider] = { active_profile: profileId, profiles: {} };
    }
    const cleanId = profileId || `profile-${Object.keys(this.config[provider].profiles).length + 1}`;
    this.config[provider].profiles[cleanId] = {
      id: cleanId,
      label: label || `Profile ${cleanId}`,
      status: 'unknown',
      rate_limited_until: null,
      last_used_at: null,
      created_at: new Date().toISOString()
    };
    this.saveConfig();
    this.getProfileDir(provider, cleanId);
    return this.config[provider].profiles[cleanId];
  }

  removeProfile(provider = DEFAULT_PROVIDER, profileId, deleteData = false) {
    if (this.config[provider]?.profiles[profileId]) {
      delete this.config[provider].profiles[profileId];
      if (this.config[provider].active_profile === profileId) {
        const remaining = Object.keys(this.config[provider].profiles);
        this.config[provider].active_profile = remaining[0] || null;
      }
      this.saveConfig();

      if (deleteData) {
        const dir = path.join(this.dataDir, provider, profileId);
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      return true;
    }
    return false;
  }

  getNextAvailableProfile(provider = DEFAULT_PROVIDER, preferredId = null) {
    this.cleanExpiredLimits(provider);
    const providerConfig = this.config[provider];
    if (!providerConfig || Object.keys(providerConfig.profiles).length === 0) {
      this.addProfile(provider, 'profile-1', 'Default Profile 1');
    }

    const profiles = Object.values(this.config[provider].profiles);

    // If preferred profile is ready, try it first
    if (preferredId) {
      const preferred = profiles.find((p) => p.id === preferredId);
      if (preferred && preferred.status !== 'rate_limited') {
        return { available: true, profile: preferred };
      }
    }

    // Filter profiles that are not currently rate-limited
    const available = profiles.filter((p) => p.status !== 'rate_limited');

    if (available.length > 0) {
      // Pick the least recently used profile among available ones
      available.sort((a, b) => {
        const timeA = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const timeB = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        return timeA - timeB;
      });

      const selected = available[0];
      this.config[provider].active_profile = selected.id;
      this.saveConfig();
      return { available: true, profile: selected };
    }

    // If all are rate-limited, find earliest reset time
    let earliestReset = null;
    for (const p of profiles) {
      if (p.rate_limited_until) {
        const resetDate = new Date(p.rate_limited_until);
        if (!earliestReset || resetDate < earliestReset) {
          earliestReset = resetDate;
        }
      }
    }

    const waitMs = earliestReset ? Math.max(0, earliestReset.getTime() - Date.now()) : 0;
    const waitMinutes = Math.ceil(waitMs / (1000 * 60));

    return {
      available: false,
      earliestReset: earliestReset ? earliestReset.toISOString() : null,
      waitMinutes,
      profiles
    };
  }

  markRateLimited(provider = DEFAULT_PROVIDER, profileId, untilDate = null) {
    const prof = this.config[provider]?.profiles[profileId];
    if (!prof) return;

    prof.status = 'rate_limited';
    // If no explicit date parsed, default to 3 hours cooldown typical for Claude free tier
    const resetDate = untilDate || new Date(Date.now() + 3 * 60 * 60 * 1000);
    prof.rate_limited_until = resetDate.toISOString();
    prof.last_used_at = new Date().toISOString();
    this.saveConfig();
  }

  markSuccess(provider = DEFAULT_PROVIDER, profileId) {
    const prof = this.config[provider]?.profiles[profileId];
    if (!prof) return;

    prof.status = 'ready';
    prof.rate_limited_until = null;
    prof.last_used_at = new Date().toISOString();
    this.saveConfig();
  }

  markStatus(provider = DEFAULT_PROVIDER, profileId, status) {
    const prof = this.config[provider]?.profiles[profileId];
    if (!prof) return;
    prof.status = status;
    this.saveConfig();
  }
}
