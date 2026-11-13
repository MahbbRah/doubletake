export const CLAUDE_SELECTORS = {
  // Input fields
  COMPOSER: [
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]',
    'fieldset div[contenteditable="true"]',
    'textarea'
  ],

  // Buttons
  SEND_BUTTON: [
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="Send"]',
    'button[data-testid="send-button"]',
    'button:has(svg.lucide-arrow-up)'
  ],

  STOP_BUTTON: [
    'button[aria-label*="Stop"]',
    'button:has-text("Stop responding")',
    'button:has-text("Stop generation")'
  ],

  FILE_INPUT: 'input[type="file"]',

  ATTACH_BUTTON: [
    'button[aria-label*="Upload"]',
    'button[aria-label*="Attach"]',
    'button[aria-label*="Add content"]'
  ],

  // Assistant message output
  ASSISTANT_MESSAGES: [
    '[data-message-author-role="assistant"]',
    'div.font-claude-message',
    'div.standard-markdown'
  ],

  // Rate limit detection
  RATE_LIMIT_ELEMENTS: [
    'div:has-text("reached your message limit")',
    'div:has-text("out of free messages")',
    'div:has-text("free message limit")',
    'div:has-text("until tomorrow")',
    'div:has-text("limit until")',
    'div:has-text("resets at")',
    'p:has-text("limit until")'
  ],

  // Login indicator
  LOGIN_INDICATORS: [
    'input[type="email"]',
    'button:has-text("Continue with Google")',
    'button:has-text("Continue with Email")',
    'a[href*="/login"]'
  ]
};
