/**
 * background.js – Service Worker for QA Cache Cleaner
 *
 * Responsibilities:
 *  1. Handle keyboard shortcut commands.
 *  2. Perform browsingData cleanup on behalf of the popup (avoids popup-close race).
 *  3. Write history records into chrome.storage.local.
 *  4. Badge the action icon with environment label of the active tab.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_HISTORY = 100;

// ---------------------------------------------------------------------------
// Message Router
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'CLEAR_DATA':
      handleClearData(msg.payload).then(sendResponse).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // keep channel open for async

    case 'GET_ACTIVE_TAB':
      getActiveTab().then(sendResponse).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;

    case 'ADD_HISTORY':
      addHistory(msg.payload).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
      return true;

    case 'SET_BADGE':
      setBadge(msg.payload);
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTabRaw();
  if (!tab) return;

  const parsed = parseTabUrl(tab.url);
  if (!parsed.valid) return;

  if (command === 'clear-cache-only') {
    const result = await handleClearData({
      origin: parsed.origin,
      hostname: parsed.hostname,
      dataTypes: { cache: true, cacheStorage: true },
      since: 0,
      label: 'Keyboard shortcut – cache only'
    });
    showCommandNotification(result, 'Cache cleared', tab);
  }

  if (command === 'clear-cache-reload') {
    const result = await handleClearData({
      origin: parsed.origin,
      hostname: parsed.hostname,
      dataTypes: { cache: true, cacheStorage: true },
      since: 0,
      label: 'Keyboard shortcut – cache + reload'
    });
    if (result.ok && tab.id) {
      chrome.tabs.reload(tab.id, { bypassCache: true });
    }
    showCommandNotification(result, 'Cache cleared & reloading…', tab);
  }
});

// ---------------------------------------------------------------------------
// Core cleanup handler
// ---------------------------------------------------------------------------
/**
 * Performs a scoped browsingData removal.
 *
 * IMPORTANT NOTES ON API LIMITATIONS (documented honestly):
 * - chrome.browsingData.remove() accepts an `origins` filter (array of origin strings)
 *   only in Chrome 74+. This scopes cache removal to exact origins.
 * - The `excludedOrigins` filter is available for further precision.
 * - HTTP cache is stored per-origin but Chrome's internal cache is also shared
 *   across subresource loads. Clearing one origin's cache does NOT guarantee
 *   resources fetched from CDNs or third-party origins used by that page are cleared.
 * - `localStorage` and `sessionStorage` can only be cleared via browsingData with
 *   origins filter (Chrome 74+). sessionStorage is cleared when the tab closes anyway.
 * - Service worker unregistration via browsingData clears caches managed by that SW.
 * - Cookies are origin/domain scoped but domain cookies (e.g., .example.com) may
 *   span multiple subdomains. We warn the user accordingly.
 * - Port-specific origins (e.g., http://localhost:3000) are treated separately from
 *   http://localhost:3001 – each must be cleared independently.
 */
async function handleClearData(payload) {
  const {
    origin,       // e.g. "https://example.com"
    hostname,     // e.g. "example.com"
    dataTypes,    // { cache, cookies, localStorage, sessionStorage, indexedDB, cacheStorage, serviceWorkers, fileSystems }
    since,        // ms timestamp or 0 for all time
    label
  } = payload;

  if (!origin || !hostname) {
    return { ok: false, error: 'Missing origin or hostname.' };
  }

  // Build the removal options
  const removalOptions = {
    since: since || 0,
    origins: [origin]
  };

  // Build the dataToRemove object – only include types that are requested
  const dataToRemove = {};
  const removed = [];
  const skipped = [];
  const warnings = [];

  // Map of requested flag → browsingData key
  const typeMap = {
    cache:          'cache',
    cookies:        'cookies',
    localStorage:   'localStorage',
    sessionStorage: 'fileSystems', // sessionStorage is not directly supported as a standalone type;
                                   // see note below
    indexedDB:      'indexedDB',
    cacheStorage:   'cacheStorage',
    serviceWorkers: 'serviceWorkers',
    fileSystems:    'fileSystems'
  };

  // sessionStorage note: chrome.browsingData does NOT expose sessionStorage as a
  // separate data type. It is cleared implicitly when localStorage is cleared OR
  // when the tab navigates/closes. We inform the user but do not falsely claim removal.
  if (dataTypes.sessionStorage) {
    skipped.push('sessionStorage');
    warnings.push(
      'sessionStorage cannot be directly cleared via chrome.browsingData. ' +
      'It is automatically cleared when the tab closes or navigates away.'
    );
  }

  // Build the set of types to actually request
  const supportedTypes = ['cache', 'cookies', 'localStorage', 'indexedDB', 'cacheStorage', 'serviceWorkers'];
  for (const type of supportedTypes) {
    if (dataTypes[type]) {
      dataToRemove[type] = true;
      removed.push(type);
    }
  }

  if (Object.keys(dataToRemove).length === 0) {
    return { ok: false, error: 'No data types selected.' };
  }

  try {
    await chrome.browsingData.remove(removalOptions, dataToRemove);

    const record = {
      origin,
      hostname,
      timestamp: Date.now(),
      dataTypes: removed,
      warnings,
      skipped,
      label: label || ''
    };
    await addHistory(record);

    return { ok: true, removed, skipped, warnings };
  } catch (err) {
    // Some browsers/versions may not support the origins filter for all data types.
    // We do NOT fall back to global clearing. Instead we report the error.
    return {
      ok: false,
      error: err.message || 'Unknown error during browsingData.remove()',
      removed: [],
      skipped,
      warnings
    };
  }
}

// ---------------------------------------------------------------------------
// Tab helpers
// ---------------------------------------------------------------------------
async function getActiveTabRaw() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function getActiveTab() {
  const tab = await getActiveTabRaw();
  if (!tab) return { ok: false, error: 'No active tab found.' };

  const parsed = parseTabUrl(tab.url);
  return {
    ok: true,
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    ...parsed
  };
}

/**
 * Parses a tab URL and returns structured info.
 * Returns valid=false for chrome://, about:, data:, and other unsupported URLs.
 */
function parseTabUrl(url) {
  if (!url) return { valid: false, reason: 'No URL provided.' };

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL.' };
  }

  const { protocol, hostname, port, origin } = parsed;

  if (['chrome:', 'chrome-extension:', 'about:', 'data:', 'javascript:', 'blob:'].includes(protocol)) {
    return {
      valid: false,
      reason: `Cannot operate on ${protocol} pages.`,
      protocol
    };
  }

  if (!['http:', 'https:', 'file:'].includes(protocol)) {
    return {
      valid: false,
      reason: `Unsupported protocol: ${protocol}`,
      protocol
    };
  }

  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local');

  return {
    valid: true,
    protocol,
    hostname,
    port: port || (protocol === 'https:' ? '443' : '80'),
    origin,
    isLocalhost,
    displayHost: port ? `${hostname}:${port}` : hostname
  };
}

// ---------------------------------------------------------------------------
// History management
// ---------------------------------------------------------------------------
async function addHistory(record) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift(record); // newest first
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  await chrome.storage.local.set({ history });
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
function setBadge(payload) {
  const { env, tabId } = payload || {};
  if (!env) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const colors = {
    PROD:    '#e53935',
    STAGING: '#fb8c00',
    QA:      '#8e24aa',
    DEV:     '#1e88e5'
  };

  const text = env.substring(0, 1); // P / S / Q / D
  const color = colors[env] || '#607d8b';

  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
}

// ---------------------------------------------------------------------------
// Notification helper (for keyboard shortcuts)
// ---------------------------------------------------------------------------
function showCommandNotification(result, successMsg, _tab) {
  // We use console only; Chrome MV3 service workers cannot use alert().
  // The popup, when open, will update its own UI via storage change events.
  if (result.ok) {
    console.info('[QA Cache Cleaner]', successMsg, result);
  } else {
    console.warn('[QA Cache Cleaner] Cleanup failed:', result.error);
  }
}

// ---------------------------------------------------------------------------
// Startup: update badge when active tab changes
// ---------------------------------------------------------------------------
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateBadgeForTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url) await updateBadgeForTab(tabId);
});

async function updateBadgeForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) return;

    const parsed = parseTabUrl(tab.url);
    if (!parsed.valid) {
      chrome.action.setBadgeText({ text: '', tabId });
      return;
    }

    const { savedSites = [] } = await chrome.storage.local.get('savedSites');
    const match = savedSites.find(s => {
      const siteDomain = s.domain.replace(/^https?:\/\//, '').split('/')[0];
      return parsed.hostname === siteDomain || parsed.hostname.endsWith('.' + siteDomain);
    });

    if (match?.env) {
      setBadge({ env: match.env, tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  } catch {
    // Tab may have been closed
  }
}

// Expose parseTabUrl for testing (importable in MV3 modules)
export { parseTabUrl, handleClearData };
