import assert from 'node:assert';
import { TemplateEngine } from '../src/core/template-engine.js';
import { PayloadBundler } from '../src/core/payload-bundler.js';
import { ProfileManager } from '../src/core/profile-manager.js';
import { ClaudeProvider } from '../src/providers/claude/claude-provider.js';

console.log('🧪 Starting cross-verifier test suite...\n');

// 1. TemplateEngine formatting and parsing
console.log('Test 1: TemplateEngine formatting and verdict parsing');
const promptOutput = TemplateEngine.formatVerificationPrompt({
  mode: 'code-review',
  prompt: 'Verify authentication middleware',
  diff: '+ const isAuth = true;',
  fileContents: [{ path: 'auth.js', lang: 'javascript', content: 'export const check = () => true;' }]
});

assert(promptOutput.includes('Verification Request'), 'Should contain Verification Request header');
assert(promptOutput.includes('Verify authentication middleware'), 'Should include prompt');
assert(promptOutput.includes('auth.js'), 'Should include file content block');
assert(promptOutput.includes('FINAL VERDICT'), 'Should include final verdict section instructions');

const mockClaudeResponse = `
I have reviewed your authentication middleware.
The code looks structurally sound, but tests should be run.

\`\`\`bash
npm test
npm run lint
\`\`\`

---
### FINAL VERDICT
- **Status**: PASS
- **Confidence**: HIGH
- **Summary**: Implementation cleanly isolates authentication without side effects.
- **Key Findings**: None
- **Actionable Recommendations**: None needed.
---
`;

const parsedVerdict = TemplateEngine.parseVerdict(mockClaudeResponse);
assert.strictEqual(parsedVerdict.status, 'PASS', 'Status should be PASS');
assert.strictEqual(parsedVerdict.confidence, 'HIGH', 'Confidence should be HIGH');
assert(parsedVerdict.summary.includes('Implementation cleanly isolates'), 'Summary should match');
assert.deepStrictEqual(parsedVerdict.copyable_commands, ['npm test', 'npm run lint'], 'Should extract copyable bash commands');
console.log('  ✅ TemplateEngine passed!\n');

// 2. ClaudeProvider parseRateLimitDate
console.log('Test 2: ClaudeProvider rate limit timestamp parser');
const dummyMgr = new ProfileManager();
const claudeProvider = new ClaudeProvider(dummyMgr);

const limitText1 = "You've reached your free message limit until 8:00 PM.";
const reset1 = claudeProvider.parseRateLimitDate(limitText1);
assert(reset1 instanceof Date, 'Should return a Date instance');

const limitText2 = 'Out of messages. Try again in 2 hours.';
const reset2 = claudeProvider.parseRateLimitDate(limitText2);
assert(reset2 instanceof Date, 'Should return a Date instance');
assert(reset2.getTime() > Date.now() + 1.8 * 3600 * 1000, 'Should be ~2 hours in future');
console.log('  ✅ ClaudeProvider rate limit parser passed!\n');

// 3. PayloadBundler
console.log('Test 3: PayloadBundler file inspection');
const payload = PayloadBundler.preparePayload({
  files: ['package.json'],
  cwd: process.cwd()
});
assert(payload.fileContents.length === 1, 'Should find and load package.json');
assert.strictEqual(payload.fileContents[0].lang, 'json', 'Should detect json language');
console.log('  ✅ PayloadBundler passed!\n');

// 4. ProfileManager rotation logic
console.log('Test 4: ProfileManager rotation and cooldown tracking');
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const testConfigDir = path.join(os.tmpdir(), `cv-test-${Date.now()}`);
const testConfigPath = path.join(testConfigDir, 'profiles.json');
const testDataDir = path.join(testConfigDir, 'profiles');

const mgr = new ProfileManager(testConfigPath, testDataDir);
// Remove initial default profile-1 for precise isolated testing
mgr.removeProfile('claude', 'profile-1');

mgr.addProfile('claude', 'test-p1', 'Test Profile 1');
mgr.addProfile('claude', 'test-p2', 'Test Profile 2');

// Mark p1 rate limited
mgr.markRateLimited('claude', 'test-p1', new Date(Date.now() + 60 * 60 * 1000));
const next = mgr.getNextAvailableProfile('claude');
assert.strictEqual(next.available, true, 'Next profile should be available');
assert.strictEqual(next.profile.id, 'test-p2', 'Should auto-rotate to test-p2');

// Mark p2 rate limited as well
mgr.markRateLimited('claude', 'test-p2', new Date(Date.now() + 120 * 60 * 1000));
const exhausted = mgr.getNextAvailableProfile('claude');
assert.strictEqual(exhausted.available, false, 'Should report exhaustion when all limited');
assert(exhausted.waitMinutes > 0, 'Should report positive wait minutes');

// Clean up
fs.rmSync(testConfigDir, { recursive: true, force: true });
console.log('  ✅ ProfileManager passed!\n');

// 5. SessionManager multi-profile chain continuity & handoff
console.log('Test 5: SessionManager chain continuity & cross-profile handoff');
import { SessionManager } from '../src/core/session-manager.js';

const testSessionFile = path.join(os.tmpdir(), `dt-sess-${Date.now()}.json`);
const sessionMgr = new SessionManager(testSessionFile);

const testSessionId = 'antigravity-conv-12345';

// Turn 1 on profile-2
sessionMgr.recordTurn({
  sessionId: testSessionId,
  profileId: 'profile-2',
  chatUrl: 'https://claude.ai/chat/chat-abc-123',
  prompt: 'Verify initial authentication middleware',
  mode: 'security-audit',
  verdict: { status: 'FAIL', summary: 'Missing JWT expiration validation' },
  response: '**Key Findings**:\n- JWT tokens do not validate expiration timestamp.\n- Unhandled null token.'
});

// Check same profile continuity
const threadForP2 = sessionMgr.getThreadForProfile(testSessionId, 'profile-2');
assert.strictEqual(threadForP2, 'https://claude.ai/chat/chat-abc-123', 'Should retrieve existing chat URL for profile-2');

const preambleP2 = sessionMgr.buildHandoffPreamble(testSessionId, 'profile-2');
assert.strictEqual(preambleP2, null, 'Same profile should NOT receive a handoff preamble (already has the thread history)');

// Check cross-profile handoff when rotating to profile-3
const threadForP3 = sessionMgr.getThreadForProfile(testSessionId, 'profile-3');
assert.strictEqual(threadForP3, null, 'New profile has no thread yet');

const preambleP3 = sessionMgr.buildHandoffPreamble(testSessionId, 'profile-3');
assert(preambleP3 !== null, 'New profile should receive a handoff preamble');
assert(preambleP3.includes('Multi-Profile Context Handoff'), 'Preamble should announce handoff');
assert(preambleP3.includes('FAIL'), 'Preamble should include previous verdict status');
assert(preambleP3.includes('Missing JWT expiration validation'), 'Preamble should include previous issue summary');
assert(preambleP3.includes('Turn 1 by Profile `profile-2`'), 'Preamble should cite previous turn');

// Turn 2 on profile-3 (after developer fixes the issue)
sessionMgr.recordTurn({
  sessionId: testSessionId,
  profileId: 'profile-3',
  chatUrl: 'https://claude.ai/chat/chat-xyz-789',
  prompt: 'Verify fix for JWT expiration',
  mode: 'security-audit',
  verdict: { status: 'PASS', summary: 'JWT expiration now validated properly' },
  response: '**Key Findings**:\n- Expiration validated correctly.'
});

const sessionAfterTurn2 = sessionMgr.getSession(testSessionId);
assert.strictEqual(sessionAfterTurn2.turns.length, 2, 'Session should have 2 recorded turns');

// Clean up
if (fs.existsSync(testSessionFile)) fs.unlinkSync(testSessionFile);
console.log('  ✅ SessionManager passed!\n');

console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
