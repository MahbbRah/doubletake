import { VERIFICATION_MODES } from '../config.js';

export class TemplateEngine {
  static getModeInstructions(mode) {
    switch (mode) {
      case VERIFICATION_MODES.CODE_REVIEW:
        return `You are acting as an expert principal software architect conducting an uncompromising, in-depth code review.
Inspect the provided code and changes for:
1. Architectural integrity, separation of concerns, and clean design patterns.
2. Code hygiene, readability, maintainability, and idiomatic conventions.
3. Edge case coverage, error handling, and robust typing/validation.
4. Unintended side-effects or regressions against existing functionality.`;

      case VERIFICATION_MODES.BUG_CHECK:
        return `You are acting as a deep runtime reliability and debugging specialist.
Inspect the provided code and changes strictly for:
1. Null/undefined dereferences, unhandled exceptions, and fatal runtime crashes.
2. Asynchronous race conditions, unhandled Promise rejections, and event loop starvation.
3. Resource/memory leaks, dangling event listeners, and unclosed file/socket descriptors.
4. Boundary condition flaws (e.g. off-by-one errors, empty array/object accesses, negative numbers).`;

      case VERIFICATION_MODES.SECURITY_AUDIT:
        return `You are acting as a senior application security auditor.
Inspect the provided code and changes strictly for:
1. Injection vulnerabilities (command injection, SQL/NoSQL injection, prototype pollution).
2. Broken authentication, authorization bypasses, or insecure direct object references (IDOR).
3. Secret/credential leakage, insecure logging, or improper crypto implementations.
4. Malicious inputs, SSRF, path traversal, or insecure deserialization risks.`;

      case VERIFICATION_MODES.GENERAL_VERIFICATION:
      default:
        return `You are an independent senior software verifier.
Carefully review the proposed changes or solution against the specified requirements. Verify whether the implementation correctly satisfies the objective, handles errors properly, and produces high quality results.`;
    }
  }

  static formatVerificationPrompt({
    mode = VERIFICATION_MODES.CODE_REVIEW,
    prompt = '',
    diff = '',
    fileContents = []
  }) {
    const instructions =
      mode === VERIFICATION_MODES.CUSTOM
        ? 'Please evaluate the provided code or details according to the instructions below.'
        : this.getModeInstructions(mode);

    let promptBody = `## Verification Request\n${instructions}\n\n`;

    if (prompt && prompt.trim()) {
      promptBody += `### Task Requirements & Context:\n${prompt.trim()}\n\n`;
    }

    if (diff && diff.trim()) {
      promptBody += `### Git Diff / Changes:\n\`\`\`diff\n${diff.trim()}\n\`\`\`\n\n`;
    }

    if (fileContents && fileContents.length > 0) {
      promptBody += `### Source Files:\n`;
      for (const item of fileContents) {
        promptBody += `#### File: \`${item.path}\`\n\`\`\`${item.lang || ''}\n${item.content}\n\`\`\`\n\n`;
      }
    }

    promptBody += `### Agent & Copy-Friendly Formatting Requirements (IMPORTANT):
Your response will be ingested directly by an AI coding assistant (Antigravity) and terminal automation.
To allow immediate, seamless execution without manual editing, adhere strictly to the following formatting rules:

1. **Provide Copyable Terminal Commands**:
   Any command needed to verify, test, install dependencies, reproduce a bug, or apply a patch MUST be provided in clean, isolated \`\`\`bash code blocks (e.g. \`npm test\`, \`git checkout -b fix\`).

2. **Provide Precise, Copyable Code Fixes**:
   If code modifications are needed, do NOT just describe them in prose. Provide exact drop-in replacements formatted with:
   - Target file path: \`**Target File**: path/to/file.ext\`
   - Code block with full replacement snippet.

3. **Definitive Verdict Section**:
   End your response with this standardized block:

---
### FINAL VERDICT
- **Status**: [PASS | FAIL | WARNINGS]
- **Confidence**: [HIGH | MEDIUM | LOW]
- **Summary**: (1-2 sentences summarizing your overall finding)
- **Key Findings**:
  - Issue 1: ...
  - Issue 2: ...
- **Actionable Recommendations & Copyable Fixes**:
  (List recommendations with copyable \`\`\`bash command blocks and code blocks below each)
---`;

    return promptBody;
  }

  static extractCopyableCommands(text) {
    if (!text) return [];
    const commands = [];
    const bashRegex = /```(?:bash|sh|zsh)\n([\s\S]*?)```/gi;
    let match;

    while ((match = bashRegex.exec(text)) !== null) {
      const block = match[1].trim();
      const lines = block.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
          commands.push(trimmed);
        }
      }
    }

    // Deduplicate
    return [...new Set(commands)];
  }

  static parseVerdict(responseText) {
    if (!responseText) {
      return {
        status: 'UNKNOWN',
        confidence: 'UNKNOWN',
        summary: 'No response received',
        copyable_commands: []
      };
    }

    const verdictMatch = responseText.match(/###\s*FINAL\s*VERDICT([\s\S]*?)(?:$)/i);
    const block = verdictMatch ? verdictMatch[1] : responseText;

    const statusMatch = block.match(/\*\*Status\*\*:\s*\[?(PASS|FAIL|WARNINGS|WARN)\]?/i);
    const confidenceMatch = block.match(/\*\*Confidence\*\*:\s*\[?(HIGH|MEDIUM|LOW)\]?/i);
    const summaryMatch = block.match(/\*\*Summary\*\*:\s*([^\n]+)/i);

    let status = 'UNKNOWN';
    if (statusMatch) {
      const raw = statusMatch[1].toUpperCase();
      status = raw === 'WARN' ? 'WARNINGS' : raw;
    } else {
      if (/VERDICT:\s*PASS/i.test(responseText) || /VERDICT\s*=\s*PASS/i.test(responseText)) status = 'PASS';
      else if (/VERDICT:\s*FAIL/i.test(responseText) || /VERDICT\s*=\s*FAIL/i.test(responseText)) status = 'FAIL';
      else if (/VERDICT:\s*WARNINGS?/i.test(responseText)) status = 'WARNINGS';
    }

    const copyableCommands = this.extractCopyableCommands(responseText);

    return {
      status,
      confidence: confidenceMatch ? confidenceMatch[1].toUpperCase() : 'MEDIUM',
      summary: summaryMatch ? summaryMatch[1].trim() : 'Analysis completed.',
      copyable_commands: copyableCommands,
      fullResponse: responseText
    };
  }
}
