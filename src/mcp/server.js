import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ProfileManager } from '../core/profile-manager.js';
import { getProvider } from '../providers/index.js';
import { DEFAULT_PROVIDER, VERIFICATION_MODES } from '../config.js';

export function createMcpServer() {
  const mcp = new McpServer({
    name: 'doubletake',
    version: '1.0.0'
  });

  const profileManager = new ProfileManager();

  // Verification Handler
  async function handleVerify(args) {
    const providerName = args.provider || DEFAULT_PROVIDER;
    const provider = getProvider(providerName, profileManager);

    try {
      const result = await provider.verify({
        prompt: args.prompt,
        diff: args.diff || '',
        files: args.files || [],
        mode: args.mode || VERIFICATION_MODES.CODE_REVIEW,
        preferredProfile: args.profile || null,
        sessionId: args.session_id || null,
        threadId: args.thread_id || null,
        engine: args.engine || 'chrome',
        cdpUrl: args.cdp_url || 'http://127.0.0.1:9222',
        waitIfRateLimited: args.wait_if_rate_limited || false,
        interactive: false
      });

      const responsePayload = {
        success: true,
        session_id: result.sessionId,
        verdict: result.verdict.status,
        confidence: result.verdict.confidence,
        summary: result.verdict.summary,
        copyable_commands: result.verdict.copyable_commands || [],
        profile_used: result.profileUsed,
        profile_label: result.profileLabel,
        chat_url: result.chatUrl,
        analysis: result.response
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(responsePayload, null, 2)
          }
        ]
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `DoubleTake verification failed: ${err.message}`
          }
        ],
        isError: true
      };
    }
  }

  // Verification Schema
  const verifySchema = {
    prompt: z.string().min(1).describe('The verification query, review instructions, or task criteria'),
    mode: z
      .enum([
        VERIFICATION_MODES.CODE_REVIEW,
        VERIFICATION_MODES.BUG_CHECK,
        VERIFICATION_MODES.SECURITY_AUDIT,
        VERIFICATION_MODES.GENERAL_VERIFICATION,
        VERIFICATION_MODES.CUSTOM
      ])
      .default(VERIFICATION_MODES.CODE_REVIEW)
      .describe('Verification mode template'),
    files: z
      .array(z.string())
      .default([])
      .describe('Array of relative or absolute file paths to be reviewed/verified'),
    diff: z.string().optional().describe('Git diff or patch text to be inspected'),
    session_id: z
      .string()
      .optional()
      .describe(
        'Unique session or Antigravity conversation ID. Automatically preserves conversation thread continuity on the same profile and generates cross-profile handoffs when rotating profiles.'
      ),
    provider: z.enum(['claude']).default('claude').describe('Web LLM provider (default: claude)'),
    profile: z.string().optional().describe('Preferred profile ID to use if available'),
    thread_id: z.string().optional().describe('Optional conversation thread ID to continue in Claude'),
    engine: z
      .enum(['chrome', 'obscura', 'cdp'])
      .default('chrome')
      .describe('Browser engine to use: chrome (default Google Chrome) or obscura/cdp (lightweight CDP server)'),
    cdp_url: z
      .string()
      .optional()
      .describe('CDP server URL if using obscura/cdp (default: http://127.0.0.1:9222)'),
    wait_if_rate_limited: z
      .boolean()
      .default(false)
      .describe('Whether to pause and wait for the cooldown timer if all profiles are exhausted')
  };

  // Register primary and alias tools
  mcp.tool(
    'doubletake',
    'DoubleTake: Cross-verifies code, system design, or bug fixes with an independent LLM via automated browser sessions with rate-limit profile rotation.',
    verifySchema,
    handleVerify
  );

  mcp.tool(
    'doubletake_verify',
    'Alias for doubletake: run autonomous verification and code reviews.',
    verifySchema,
    handleVerify
  );

  mcp.tool(
    'cross_verify',
    'Legacy alias for doubletake.',
    verifySchema,
    handleVerify
  );

  mcp.tool(
    'verify_with_claude',
    'Alias specifically targeting Claude.ai web profiles.',
    verifySchema,
    handleVerify
  );

  // Status tool
  const statusHandler = async (args) => {
    const providerName = args.provider || DEFAULT_PROVIDER;
    const profiles = profileManager.listProfiles(providerName);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ provider: providerName, profiles }, null, 2)
        }
      ]
    };
  };

  mcp.tool(
    'doubletake_status',
    'Check availability, cooldown timestamps, and active status across all registered browser profiles.',
    {
      provider: z.enum(['claude']).default('claude').describe('Provider name')
    },
    statusHandler
  );

  mcp.tool(
    'verifier_status',
    'Alias for doubletake_status.',
    {
      provider: z.enum(['claude']).default('claude').describe('Provider name')
    },
    statusHandler
  );

  // Add profile tool
  mcp.tool(
    'add_profile',
    'Register a new profile for browser automation.',
    {
      profile_id: z.string().min(1).describe('Unique ID for the profile (e.g. profile-2)'),
      label: z.string().optional().describe('Human-readable label (e.g. Secondary Account)'),
      provider: z.enum(['claude']).default('claude').describe('Provider name')
    },
    async (args) => {
      const providerName = args.provider || DEFAULT_PROVIDER;
      const added = profileManager.addProfile(providerName, args.profile_id, args.label);
      return {
        content: [
          {
            type: 'text',
            text: `Profile '${added.id}' registered. Run 'npx doubletake login --profile=${added.id}' to authenticate it once.`
          }
        ]
      };
    }
  );

  // Remove profile tool
  mcp.tool(
    'remove_profile',
    'Unregister and optionally delete a profile from doubletake.',
    {
      profile_id: z.string().min(1).describe('Unique ID of the profile to remove'),
      delete_data: z.boolean().default(false).describe('Whether to also delete the browser cache/data folder on disk'),
      provider: z.enum(['claude']).default('claude').describe('Provider name')
    },
    async (args) => {
      const providerName = args.provider || DEFAULT_PROVIDER;
      const removed = profileManager.removeProfile(providerName, args.profile_id, args.delete_data);
      if (removed) {
        return {
          content: [
            {
              type: 'text',
              text: `Profile '${args.profile_id}' successfully removed${args.delete_data ? ' and its browser storage deleted' : ''}.`
            }
          ]
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Profile '${args.profile_id}' not found.`
          }
        ],
        isError: true
      };
    }
  );

  return mcp;
}

export async function startMcpServer() {
  console.log = (...args) => console.error(...args);
  const mcp = createMcpServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error('[DoubleTake] MCP server started and listening on stdio.');
}
