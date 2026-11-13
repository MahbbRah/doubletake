export class BaseProvider {
  constructor(profileManager) {
    if (!profileManager) {
      throw new Error('ProfileManager is required for BaseProvider');
    }
    this.profileManager = profileManager;
  }

  get providerName() {
    throw new Error('providerName getter must be implemented');
  }

  async login(profileId) {
    throw new Error('login() must be implemented by provider');
  }

  async verify(options) {
    throw new Error('verify() must be implemented by provider');
  }

  async checkRateLimit(page) {
    throw new Error('checkRateLimit() must be implemented by provider');
  }

  async extractResponse(page) {
    throw new Error('extractResponse() must be implemented by provider');
  }
}
