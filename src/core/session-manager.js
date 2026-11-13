import fs from 'node:fs';
import path from 'node:path';
import { BASE_DIR, SESSIONS_CONFIG_PATH } from '../config.js';

export class SessionManager {
  constructor(configPath = SESSIONS_CONFIG_PATH) {
    this.configPath = configPath;
    this.baseDir = path.dirname(configPath);
    this.ensureDirectory();
    this.sessions = this.loadSessions();
  }

  ensureDirectory() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  loadSessions() {
    if (!fs.existsSync(this.configPath)) {
      const initial = {};
      this.saveSessions(initial);
      return initial;
    }

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  saveSessions(sessions = this.sessions) {
    fs.writeFileSync(this.configPath, JSON.stringify(sessions, null, 2), 'utf-8');
  }

  getSession(sessionId) {
    if (!sessionId) return null;
    return this.sessions[sessionId] || null;
  }

  getOrCreateSession(sessionId, prompt = '') {
    if (!sessionId) {
      // Ephemeral session
      return null;
    }

    if (!this.sessions[sessionId]) {
      this.sessions[sessionId] = {
        id: sessionId,
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        task_brief: prompt.slice(0, 300).trim(),
        threads: {}, // profileId -> chatUrl
        turns: []
      };
      this.saveSessions();
    }

    return this.sessions[sessionId];
  }

  getThreadForProfile(sessionId, profileId) {
    const session = this.getSession(sessionId);
    if (!session || !session.threads) return null;
    return session.threads[profileId] || null;
  }

  recordTurn({
    sessionId,
    profileId,
    chatUrl,
    prompt,
    mode = 'code-review',
    verdict,
    response = ''
  }) {
    if (!sessionId) return;

    const session = this.getOrCreateSession(sessionId, prompt);
    session.last_updated = new Date().toISOString();

    if (chatUrl) {
      session.threads[profileId] = chatUrl;
    }

    // Extract brief 1-2 sentence issue recap from verdict
    const summary = verdict?.summary || 'Verification completed';
    const status = verdict?.status || 'UNKNOWN';

    // Extract key findings if present
    let findingsSummary = '';
    const findingsMatch = response.match(/\*\*Key Findings\*\*:\s*([\s\S]*?)(?:\*\*Actionable|\n---|$)/i);
    if (findingsMatch) {
      findingsSummary = findingsMatch[1]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('-') || l.startsWith('*') || l.length > 0)
        .slice(0, 3)
        .join('; ');
    }

    session.turns.push({
      turn_index: session.turns.length + 1,
      profile_id: profileId,
      timestamp: new Date().toISOString(),
      mode,
      prompt_summary: prompt.slice(0, 150).replace(/\n/g, ' ').trim(),
      verdict_status: status,
      verdict_summary: summary,
      key_findings: findingsSummary || 'None noted'
    });

    this.saveSessions();
  }

  buildHandoffPreamble(sessionId, targetProfileId) {
    const session = this.getSession(sessionId);
    if (!session || !session.turns || session.turns.length === 0) {
      return null;
    }

    // If target profile ALREADY has its own thread in this session,
    // we don't need a handoff preamble because Claude already has that conversation history!
    if (session.threads[targetProfileId]) {
      return null;
    }

    // New profile taking over an ongoing session chain!
    // We compose a concise, high-signal handoff preamble.
    const lastTurn = session.turns[session.turns.length - 1];
    const totalTurns = session.turns.length;

    let preamble = `### 🔄 Multi-Profile Context Handoff (Chain Session: \`${sessionId.slice(0, 16)}...\`)\n`;
    preamble += `> **Notice**: You are continuing an ongoing verification session. Prior turn(s) were evaluated on another profile that reached its usage quota.\n\n`;

    if (session.task_brief) {
      preamble += `**Overarching Task / Feature Goal:**\n${session.task_brief}\n\n`;
    }

    preamble += `**Prior Turn Summary (Turn ${lastTurn.turn_index} by Profile \`${lastTurn.profile_id}\`):**\n`;
    preamble += `- **Previous Request**: "${lastTurn.prompt_summary}..."\n`;
    preamble += `- **Previous Verdict**: **${lastTurn.verdict_status}** — ${lastTurn.verdict_summary}\n`;
    if (lastTurn.key_findings && lastTurn.key_findings !== 'None noted') {
      preamble += `- **Key Findings**: ${lastTurn.key_findings}\n`;
    }
    preamble += `\n`;

    preamble += `**Current Objective (Turn ${totalTurns + 1}):**\n`;
    preamble += `Review the new changes or follow-up prompt below in the context of this ongoing effort. Verify whether previous concerns have been resolved properly without introducing regressions.\n`;
    preamble += `--------------------------------------------------\n\n`;

    return preamble;
  }
}
