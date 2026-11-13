import { PROVIDERS, DEFAULT_PROVIDER } from '../config.js';
import { ClaudeProvider } from './claude/claude-provider.js';

export function getProvider(providerName = DEFAULT_PROVIDER, profileManager) {
  switch (providerName.toLowerCase()) {
    case PROVIDERS.CLAUDE:
      return new ClaudeProvider(profileManager);
    default:
      throw new Error(`Unsupported provider: '${providerName}'. Currently supported: claude`);
  }
}
