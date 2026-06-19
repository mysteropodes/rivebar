/**
 * Rive MCP Community Store — Script Schema
 *
 * This file defines the canonical data model for community scripts.
 * Used by both Lite (consumer) and Pro (publisher) apps.
 * No payments are handled by the platform — support links redirect externally.
 */

/**
 * @typedef {Object} ScriptAuthor
 * @property {string} name - Display name of the creator
 * @property {string|null} avatarUrl - URL to profile image (GitHub, Ko-fi, etc.) Must be https://
 * @property {string|null} supportLink - External tip/support URL (Ko-fi, BMC, GitHub Sponsors, Patreon, PayPal.me)
 */

/**
 * @typedef {Object} CommunityScript
 * @property {string} id - Unique identifier (kebab-case)
 * @property {string} title - Display name
 * @property {string} description - What the script does (1-3 sentences)
 * @property {ScriptAuthor} author - Creator information
 * @property {string} downloadUrl - URL to fetch the script JSON from store API
 * @property {string} category - One of: "design", "animation", "rigging", "utility"
 * @property {string[]} tags - Additional search tags
 * @property {string} icon - Icon key from built-in icon set
 * @property {boolean} featured - Highlighted in "Featured" section
 * @property {number} downloadsCount - Total installs
 * @property {number} likesCount - Community likes
 * @property {boolean} hasUi - Script contains _ui steps (interactive)
 * @property {string|null} version - Semantic version (e.g. "1.0.0")
 * @property {string|null} updatedAt - ISO 8601 date of last update
 * @property {Object[]} [steps] - Script steps (only present after download, not in catalog listing)
 */

/** Allowed domains for support/tip links */
const ALLOWED_SUPPORT_DOMAINS = [
  'ko-fi.com',
  'buymeacoffee.com',
  'github.com',
  'patreon.com',
  'paypal.me',
];

/**
 * Validate a support URL against the whitelist.
 * @param {string} url
 * @returns {{valid: boolean, domain: string|null, error: string|null}}
 */
function validateSupportLink(url) {
  if (!url) return { valid: true, domain: null, error: null };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return { valid: false, domain: null, error: 'Link must use HTTPS' };
    }
    const hostname = parsed.hostname.replace(/^www\./, '');
    const matched = ALLOWED_SUPPORT_DOMAINS.find(d => hostname === d || hostname.endsWith('.' + d));
    if (!matched) {
      return { valid: false, domain: hostname, error: `Domain "${hostname}" is not in the allowed list (${ALLOWED_SUPPORT_DOMAINS.join(', ')})` };
    }
    return { valid: true, domain: matched, error: null };
  } catch {
    return { valid: false, domain: null, error: 'Invalid URL format' };
  }
}

/**
 * Detect the support platform from a URL for icon display.
 * @param {string} url
 * @returns {"kofi"|"bmc"|"github"|"patreon"|"paypal"|"heart"}
 */
function detectSupportPlatform(url) {
  if (!url) return 'heart';
  const lower = url.toLowerCase();
  if (lower.includes('ko-fi.com')) return 'kofi';
  if (lower.includes('buymeacoffee.com')) return 'bmc';
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('patreon.com')) return 'patreon';
  if (lower.includes('paypal.me')) return 'paypal';
  return 'heart';
}

/**
 * Validate an avatar URL.
 * @param {string} url
 * @returns {boolean}
 */
function validateAvatarUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Example mock script with all fields populated
const MOCK_COMMUNITY_SCRIPT = {
  id: 'auto-skin-pro',
  title: 'Auto-Skin Pro',
  description: 'Automatically bind mesh vertices to the nearest bones with distance-based weight calculation and multi-bone influence support.',
  author: {
    name: 'Cyril',
    avatarUrl: 'https://github.com/cyrilmcp.png',
    supportLink: 'https://ko-fi.com/cyrilmcp',
  },
  downloadUrl: 'https://store.rivemcp.com/api/v1/scripts/auto-skin-pro/download',
  category: 'rigging',
  tags: ['bones', 'mesh', 'weights', 'skinning'],
  icon: 'bone',
  featured: true,
  downloadsCount: 342,
  likesCount: 87,
  hasUi: false,
  version: '1.2.0',
  updatedAt: '2026-06-15T10:30:00Z',
};

if (typeof module !== 'undefined') {
  module.exports = {
    ALLOWED_SUPPORT_DOMAINS,
    validateSupportLink,
    detectSupportPlatform,
    validateAvatarUrl,
    MOCK_COMMUNITY_SCRIPT,
  };
}
