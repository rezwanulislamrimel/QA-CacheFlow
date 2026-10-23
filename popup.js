/**
 * popup.js – QA Cache Cleaner
 *
 * All DOM interaction, state management, and Chrome API calls live here.
 * The file is structured in clearly separated sections:
 *
 *   1. DOM references
 *   2. App state
 *   3. Initialization
 *   4. Tab detection
 *   5. Quick action handlers
 *   6. Data-selector UI
 *   7. Confirmation dialog
 *   8. Cleanup execution
 *   9. Status & feedback
 *  10. Saved sites CRUD
 *  11. Site editor modal
 *  12. History panel
 *  13. Theme management
 *  14. URL copy
 *  15. Options page
 *  16. Utility helpers
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
// 1. DOM REFERENCES
// ═══════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

const DOM = {
  body:                document.body,
  panelUnsupported:    $('panel-unsupported'),
  unsupportedReason:   $('unsupported-reason'),
  panelMain:           $('panel-main'),

  // Site info
  currentDomain:       $('current-domain'),
  envBadge:            $('env-badge'),
  localhostWarning:    $('localhost-warning'),
  btnCopyUrl:          $('btn-copy-url'),
  btnSaveSite:         $('btn-save-site'),

  // Quick actions
  btnClearCache:       $('btn-clear-cache'),
  btnClearReload:      $('btn-clear-reload'),
  btnClearSelected:    $('btn-clear-selected'),
  tipDomainCache:      $('tip-domain-cache'),

  // Data selector
  panelDataSelector:   $('panel-data-selector'),
  dtCache:             $('dt-cache'),
  dtCacheStorage:      $('dt-cacheStorage'),
  dtCookies:           $('dt-cookies'),
  dtLocalStorage:      $('dt-localStorage'),
  dtSessionStorage:    $('dt-sessionStorage'),
  dtIndexedDB:         $('dt-indexedDB'),
  dtServiceWorkers:    $('dt-serviceWorkers'),
  sinceSelect:         $('since-select'),
  preserveLogin:       $('preserve-login'),
  btnCloseSelector:    $('btn-close-selector'),
  btnSelectAll:        $('btn-select-all'),
  btnSelectNone:       $('btn-select-none'),
  btnRunSelected:      $('btn-run-selected'),

  // Confirmation
  panelConfirm:        $('panel-confirm'),
  confirmDetails:      $('confirm-details'),
  confirmWarn:         $('confirm-warn'),
  confirmWarnText:     $('confirm-warn-text'),
  btnConfirmCancel:    $('btn-confirm-cancel'),
  btnConfirmOk:        $('btn-confirm-ok'),

  // Status
  statusBar:           $('status-bar'),
  statusIcon:          $('status-icon'),
  statusText:          $('status-text'),
  lastCleared:         $('last-cleared'),
  lastClearedText:     $('last-cleared-text'),

  // Saved sites
  savedSitesList:      $('saved-sites-list'),
  savedSitesEmpty:     $('saved-sites-empty'),
  btnAddSite:          $('btn-add-site'),

  // History
  historyList:         $('history-list'),
  historyEmpty:        $('history-empty'),
  btnClearHistory:     $('btn-clear-history'),

  // Modal
  modalSiteEditor:     $('modal-site-editor'),
  modalTitle:          $('modal-title'),
  formSiteEditor:      $('form-site-editor'),
  fieldName:           $('field-name'),
  fieldDomain:         $('field-domain'),
  fieldEnv:            $('field-env'),
  fieldNotes:          $('field-notes'),
  errName:             $('err-name'),
  errDomain:           $('err-domain'),
  btnModalClose:       $('btn-modal-close'),
  btnModalCancel:      $('btn-modal-cancel'),
  btnModalSave:        $('btn-modal-save'),

  // Header
  btnTheme:            $('btn-theme'),
  iconSun:             $('icon-sun'),
  iconMoon:            $('icon-moon'),
  btnOptions:          $('btn-options'),
};

// ═══════════════════════════════════════════════════════════════════
// 2. APP STATE
// ═══════════════════════════════════════════════════════════════════
const state = {
  tabInfo:         null,   // result from background getActiveTab
  savedSites:      [],     // array of site objects
  history:         [],     // array of history records
  editingSiteId:   null,   // id of site being edited, null = new
  isBusy:          false,  // prevent concurrent cleanup calls
  theme:           'light',
  pendingPayload:  null,   // payload waiting for confirmation
  statusTimer:     null,
  preferences:     {}
};

// ═══════════════════════════════════════════════════════════════════
// 3. INITIALIZATION
// ═══════════════════════════════════════════════════════════════════
async function init() {
  // Load preferences and saved data
  await loadStorage();

  // Apply theme immediately to prevent flash
  applyTheme(state.theme);

  // Detect current tab
  await detectCurrentTab();

  // Render dynamic sections
  renderSavedSites();
  renderHistory();

  // Wire up all event listeners
  attachEventListeners();
}

async function loadStorage() {
  const data = await chromeStorageGet([
    'theme', 'savedSites', 'history', 'preferences', 'lastCleared'
  ]);
  state.theme       = data.theme       || 'light';
  state.savedSites  = data.savedSites  || [];
  state.history     = data.history     || [];
  state.preferences = data.preferences || {};

  // Show last-cleared timestamp if available
  if (data.lastCleared) {
    showLastCleared(data.lastCleared);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 4. TAB DETECTION
// ═══════════════════════════════════════════════════════════════════
async function detectCurrentTab() {
  const result = await sendMessage({ type: 'GET_ACTIVE_TAB' });

  if (!result || !result.ok || !result.valid) {
    showUnsupportedPanel(result?.reason || 'Cannot operate on this page type.');
    return;
  }

  state.tabInfo = result;
  showMainPanel(result);
}

function showUnsupportedPanel(reason) {
  DOM.unsupportedReason.textContent = reason;
  DOM.panelUnsupported.hidden = false;
  DOM.panelMain.hidden = true;
}

function showMainPanel(tabInfo) {
  DOM.panelMain.hidden = false;
  DOM.panelUnsupported.hidden = true;

  DOM.currentDomain.textContent = tabInfo.displayHost || tabInfo.hostname;
  DOM.tipDomainCache.textContent = tabInfo.origin;

  if (tabInfo.isLocalhost) {
    DOM.localhostWarning.hidden = false;
  }

  // Check if current site matches a saved site and show env badge
  const match = findSavedSiteForHost(tabInfo.hostname, tabInfo.port);
  if (match) {
    showEnvBadge(match.env);
    // Pulse border on PROD to draw attention
    if (match.env === 'PROD') {
      DOM.panelMain.querySelector('.site-info')?.classList.add('prod-warning');
    }
  }
}

function findSavedSiteForHost(hostname, port) {
  if (!hostname) return null;
  return state.savedSites.find(s => {
    try {
      const normalized = normalizeDomain(s.domain);
      const siteUrl = new URL(normalized);
      const siteHost = siteUrl.hostname;
      const sitePort = siteUrl.port || (siteUrl.protocol === 'https:' ? '443' : '80');
      return siteHost === hostname && sitePort === port;
    } catch {
      return false;
    }
  }) || null;
}

function showEnvBadge(env) {
  DOM.envBadge.textContent = env;
  DOM.envBadge.className = `env-badge env-${env}`;
  DOM.envBadge.hidden = false;
}

// ═══════════════════════════════════════════════════════════════════
// 5. EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════
function attachEventListeners() {
  // Quick actions
  DOM.btnClearCache.addEventListener('click', onClearCacheClick);
  DOM.btnClearReload.addEventListener('click', onClearReloadClick);
  DOM.btnClearSelected.addEventListener('click', onClearSelectedClick);

  // Data selector
  DOM.btnCloseSelector.addEventListener('click', () => { DOM.panelDataSelector.hidden = true; });
  DOM.btnSelectAll.addEventListener('click', selectAllDataTypes);
  DOM.btnSelectNone.addEventListener('click', clearAllDataTypes);
  DOM.btnRunSelected.addEventListener('click', onRunSelectedClick);
  DOM.preserveLogin.addEventListener('change', onPreserveLoginChange);

  // Confirmation
  DOM.btnConfirmCancel.addEventListener('click', closeConfirm);
  DOM.btnConfirmOk.addEventListener('click', onConfirmOk);

  // Saved sites
  DOM.btnAddSite.addEventListener('click', () => openSiteEditor(null));
  DOM.btnSaveSite.addEventListener('click', onQuickSaveSite);

  // History
  DOM.btnClearHistory.addEventListener('click', onClearHistory);

  // Modal
  DOM.btnModalClose.addEventListener('click', closeSiteEditor);
  DOM.btnModalCancel.addEventListener('click', closeSiteEditor);
  DOM.formSiteEditor.addEventListener('submit', onSiteEditorSubmit);

  // Header
  DOM.btnTheme.addEventListener('click', toggleTheme);
  DOM.btnOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // URL copy
  DOM.btnCopyUrl.addEventListener('click', onCopyUrl);

  // Close overlays on backdrop click
  DOM.panelConfirm.addEventListener('click', e => { if (e.target === DOM.panelConfirm) closeConfirm(); });
  DOM.modalSiteEditor.addEventListener('click', e => { if (e.target === DOM.modalSiteEditor) closeSiteEditor(); });

  // Keyboard: Escape closes overlays
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!DOM.panelConfirm.hidden) { closeConfirm(); return; }
      if (!DOM.modalSiteEditor.hidden) { closeSiteEditor(); return; }
      if (!DOM.panelDataSelector.hidden) { DOM.panelDataSelector.hidden = true; }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// 6. QUICK ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Clear HTTP cache + Cache Storage only (preserve login).
 * No confirmation required — login session is untouched.
 */
async function onClearCacheClick() {
  if (state.isBusy || !state.tabInfo) return;
  await runCleanup({
    dataTypes: { cache: true, cacheStorage: true },
    reload: false,
    label: 'Quick: Clear cache only'
  });
}

/**
 * Clear cache + reload. Warn user via status that this is not the
 * same as a full incognito-style clear.
 */
async function onClearReloadClick() {
  if (state.isBusy || !state.tabInfo) return;
  await runCleanup({
    dataTypes: { cache: true, cacheStorage: true },
    reload: true,
    label: 'Quick: Clear cache & reload'
  });
}

/**
 * Open the data selector panel.
 */
function onClearSelectedClick() {
  if (!state.tabInfo) return;
  DOM.panelDataSelector.hidden = false;
  // Scroll selector into view
  DOM.panelDataSelector.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Called when "Run Cleanup" is clicked in the selector panel.
 * Builds the payload and either runs directly or shows confirmation.
 */
async function onRunSelectedClick() {
  if (state.isBusy || !state.tabInfo) return;

  const payload = buildDataTypesPayload();
  if (!payload) return; // validation failed, error shown in buildDataTypesPayload

  const isDestructive = payload.dataTypes.cookies || payload.dataTypes.localStorage ||
                        payload.dataTypes.indexedDB || payload.dataTypes.serviceWorkers;

  if (isDestructive) {
    showConfirmDialog(payload);
  } else {
    await runCleanup(payload);
  }
}

/**
 * Build the payload from the current data-selector state.
 * Returns null if nothing is selected.
 */
function buildDataTypesPayload() {
  const preserveLogin = DOM.preserveLogin.checked;
  const sinceMs = parseInt(DOM.sinceSelect.value, 10);
  const since = sinceMs > 0 ? Date.now() - sinceMs : 0;

  const dataTypes = {
    cache:          DOM.dtCache.checked,
    cacheStorage:   DOM.dtCacheStorage.checked,
    cookies:        DOM.dtCookies.checked && !preserveLogin,
    localStorage:   DOM.dtLocalStorage.checked && !preserveLogin,
    sessionStorage: false, // never clearable via API — always false
    indexedDB:      DOM.dtIndexedDB.checked,
    serviceWorkers: DOM.dtServiceWorkers.checked
  };

  const selected = Object.values(dataTypes).some(Boolean);
  if (!selected) {
    showStatus('error', '⚠', 'No data types selected. Choose at least one.');
    return null;
  }

  return {
    dataTypes,
    since,
    reload: false,
    label: 'Selected cleanup'
  };
}

function onPreserveLoginChange() {
  const locked = DOM.preserveLogin.checked;
  DOM.dtCookies.disabled = locked;
  DOM.dtLocalStorage.disabled = locked;
  if (locked) {
    DOM.dtCookies.checked = false;
    DOM.dtLocalStorage.checked = false;
  }
}

function selectAllDataTypes() {
  const preserveLogin = DOM.preserveLogin.checked;
  DOM.dtCache.checked = true;
  DOM.dtCacheStorage.checked = true;
  DOM.dtIndexedDB.checked = true;
  DOM.dtServiceWorkers.checked = true;
  if (!preserveLogin) {
    DOM.dtCookies.checked = true;
    DOM.dtLocalStorage.checked = true;
  }
}

function clearAllDataTypes() {
  DOM.dtCache.checked = false;
  DOM.dtCacheStorage.checked = false;
  DOM.dtCookies.checked = false;
  DOM.dtLocalStorage.checked = false;
  DOM.dtIndexedDB.checked = false;
  DOM.dtServiceWorkers.checked = false;
}

// ═══════════════════════════════════════════════════════════════════
// 7. CONFIRMATION DIALOG
// ═══════════════════════════════════════════════════════════════════
function showConfirmDialog(payload) {
  state.pendingPayload = payload;

  const { dataTypes } = payload;
  const origin = state.tabInfo.origin;
  const selectedTypes = Object.entries(dataTypes)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const tagsHtml = selectedTypes
    .map(t => `<span class="data-tag">${t}</span>`)
    .join('');

  DOM.confirmDetails.innerHTML =
    `<p>Clear the following data for <strong>${escapeHtml(origin)}</strong>:</p>` +
    `<p style="margin-top:6px">${tagsHtml}</p>` +
    `<p style="margin-top:8px;font-size:11px;color:var(--color-text-muted)">` +
    `Note: Cookies scoped to parent domains (e.g. .example.com) may affect other subdomains.` +
    `</p>`;

  // Show warning if destructive types selected
  const warnings = [];
  if (dataTypes.cookies)      warnings.push('Clearing cookies may sign you out of this site.');
  if (dataTypes.localStorage) warnings.push('Clearing localStorage will remove saved app state.');
  if (dataTypes.serviceWorkers) warnings.push('Service workers will re-register on next page load.');

  if (warnings.length > 0) {
    DOM.confirmWarnText.textContent = warnings.join(' ');
    DOM.confirmWarn.hidden = false;
  } else {
    DOM.confirmWarn.hidden = true;
  }

  DOM.panelConfirm.hidden = false;
  DOM.btnConfirmOk.focus();
}

function closeConfirm() {
  DOM.panelConfirm.hidden = true;
  state.pendingPayload = null;
}

async function onConfirmOk() {
  const payload = state.pendingPayload;
  closeConfirm();
  if (payload) {
    await runCleanup(payload);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 8. CLEANUP EXECUTION
// ═══════════════════════════════════════════════════════════════════
/**
 * Core cleanup runner. Sends message to background script which
 * performs the actual browsingData.remove() call and writes history.
 * Reload (if requested) happens ONLY after the cleanup promise resolves.
 */
async function runCleanup(options) {
  if (state.isBusy) return;
  if (!state.tabInfo?.valid) {
    showStatus('error', '⚠', 'No valid tab info. Please reopen the extension.');
    return;
  }

  const { dataTypes, reload = false, label = '', since = 0 } = options;

  // Lock UI
  state.isBusy = true;
  setActionButtonsDisabled(true);
  showStatus('loading', '<span class="spinner"></span>', 'Clearing data…');

  const payload = {
    origin:   state.tabInfo.origin,
    hostname: state.tabInfo.hostname,
    dataTypes,
    since,
    label
  };

  try {
    const result = await sendMessage({ type: 'CLEAR_DATA', payload });

    if (!result) {
      throw new Error('No response from background script.');
    }

    // Build summary
    const removed  = result.removed  || [];
    const skipped  = result.skipped  || [];
    const warnings = result.warnings || [];

    if (result.ok) {
      const now = Date.now();
      await chromeStorageSet({ lastCleared: now });
      showLastCleared(now);

      let msg = `Cleared: ${removed.join(', ') || 'none'}.`;
      if (skipped.length)  msg += ` Not supported: ${skipped.join(', ')}.`;
      if (warnings.length) {
        showStatus('partial', '⚠', msg + ' See notes: ' + warnings[0]);
      } else {
        showStatus('success', '✓', msg);
      }

      // Reload ONLY after cleanup completes and only if the tab still exists
      if (reload && state.tabInfo.tabId) {
        try {
          await chrome.tabs.reload(state.tabInfo.tabId, { bypassCache: true });
        } catch (reloadErr) {
          // Tab may have been closed; not a cleanup failure
          console.warn('[QA Cache Cleaner] Could not reload tab:', reloadErr.message);
        }
      }

      // Refresh history display
      const storageData = await chromeStorageGet(['history']);
      state.history = storageData.history || [];
      renderHistory();

    } else {
      const errMsg = result.error || 'Unknown error.';
      // Explain known chrome.browsingData origin-filter issues
      let helpText = '';
      if (errMsg.toLowerCase().includes('origin')) {
        helpText = ' The origin filter may not be supported for all data types in this Chrome version.';
      }
      showStatus('error', '✗', `Cleanup failed: ${errMsg}${helpText}`);
    }
  } catch (err) {
    showStatus('error', '✗', `Error: ${err.message}`);
  } finally {
    state.isBusy = false;
    setActionButtonsDisabled(false);
  }
}

function setActionButtonsDisabled(disabled) {
  DOM.btnClearCache.disabled   = disabled;
  DOM.btnClearReload.disabled  = disabled;
  DOM.btnClearSelected.disabled = disabled;
  DOM.btnRunSelected.disabled  = disabled;
}

// ═══════════════════════════════════════════════════════════════════
// 9. STATUS & FEEDBACK
// ═══════════════════════════════════════════════════════════════════
function showStatus(type, iconHtml, message) {
  DOM.statusBar.hidden = false;
  DOM.statusBar.className = `status-bar status-${type}`;
  DOM.statusIcon.innerHTML = iconHtml;
  DOM.statusText.textContent = message;

  // Auto-dismiss success/partial after 5 s
  clearTimeout(state.statusTimer);
  if (type === 'success' || type === 'partial') {
    state.statusTimer = setTimeout(() => {
      DOM.statusBar.hidden = true;
    }, 5000);
  }
}

function showLastCleared(timestamp) {
  DOM.lastCleared.hidden = false;
  DOM.lastClearedText.textContent = `Last cleared: ${formatRelativeTime(timestamp)}`;
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(ts).toLocaleDateString();
}

// ═══════════════════════════════════════════════════════════════════
// 10. SAVED SITES CRUD
// ═══════════════════════════════════════════════════════════════════
function renderSavedSites() {
  const list = DOM.savedSitesList;
  list.innerHTML = '';

  if (state.savedSites.length === 0) {
    DOM.savedSitesEmpty.hidden = false;
    return;
  }
  DOM.savedSitesEmpty.hidden = true;

  state.savedSites.forEach(site => {
    const item = createSavedSiteElement(site);
    list.appendChild(item);
  });
}

function createSavedSiteElement(site) {
  const div = document.createElement('div');
  div.className = 'saved-site-item';
  div.setAttribute('role', 'listitem');

  // Check if this is the currently active site
  if (state.tabInfo?.valid) {
    try {
      const siteUrl = new URL(normalizeDomain(site.domain));
      if (siteUrl.hostname === state.tabInfo.hostname && 
          (siteUrl.port || (siteUrl.protocol === 'https:' ? '443' : '80')) === state.tabInfo.port) {
        div.classList.add('is-active-env');
      }
    } catch { /* invalid domain – ignore */ }
  }

  // Left: name, domain, env badge, notes
  const left = document.createElement('div');
  left.className = 'saved-site-left';

  const name = document.createElement('span');
  name.className = 'saved-site-name';
  name.textContent = site.name;

  const domain = document.createElement('span');
  domain.className = 'saved-site-domain';
  domain.textContent = site.domain;

  const meta = document.createElement('div');
  meta.className = 'saved-site-meta';

  if (site.env) {
    const badge = document.createElement('span');
    badge.className = `env-badge env-${site.env}`;
    badge.textContent = site.env;
    meta.appendChild(badge);
  }

  if (site.notes) {
    const note = document.createElement('span');
    note.className = 'saved-site-note';
    note.textContent = site.notes;
    meta.appendChild(note);
  }

  left.append(name, domain, meta);

  // Right: action buttons
  const actions = document.createElement('div');
  actions.className = 'saved-site-actions';

  // Open
  const btnOpen = createIconBtn(
    `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    `Open ${site.name}`,
    () => openSavedSite(site)
  );

  // Clean
  const btnClean = createIconBtn(
    `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.09"/></svg>`,
    `Clear cache for ${site.name}`,
    () => cleanSavedSite(site)
  );

  // Edit
  const btnEdit = createIconBtn(
    `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    `Edit ${site.name}`,
    () => openSiteEditor(site)
  );

  // Delete
  const btnDelete = createIconBtn(
    `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    `Delete ${site.name}`,
    () => deleteSavedSite(site.id)
  );
  btnDelete.style.color = 'var(--color-danger)';

  actions.append(btnOpen, btnClean, btnEdit, btnDelete);
  div.append(left, actions);
  return div;
}

function createIconBtn(svgHtml, ariaLabel, onClick) {
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.setAttribute('aria-label', ariaLabel);
  btn.title = ariaLabel;
  btn.innerHTML = svgHtml;
  btn.addEventListener('click', onClick);
  return btn;
}

async function openSavedSite(site) {
  const url = normalizeDomain(site.domain);
  try {
    new URL(url); // validate
    await chrome.tabs.create({ url });
  } catch {
    showStatus('error', '✗', 'Invalid URL for this saved site.');
  }
}

async function cleanSavedSite(site) {
  if (state.isBusy) return;

  // Parse the saved site's origin
  const url = normalizeDomain(site.domain);
  let parsed;
  try { parsed = new URL(url); }
  catch { showStatus('error', '✗', 'Cannot parse domain for this site.'); return; }

  const origin   = `${parsed.protocol}//${parsed.host}`;
  const hostname = parsed.hostname;
  const port     = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');

  state.isBusy = true;
  setActionButtonsDisabled(true);
  showStatus('loading', '<span class="spinner"></span>', `Clearing cache for ${hostname}…`);

  try {
    const result = await sendMessage({
      type: 'CLEAR_DATA',
      payload: {
        origin,
        hostname,
        dataTypes: { cache: true, cacheStorage: true },
        since: 0,
        label: `Saved site cleanup: ${site.name}`
      }
    });

    if (result?.ok) {
      const now = Date.now();
      await chromeStorageSet({ lastCleared: now });
      showLastCleared(now);
      showStatus('success', '✓', `Cache cleared for ${hostname}`);
      const storageData = await chromeStorageGet(['history']);
      state.history = storageData.history || [];
      renderHistory();
    } else {
      showStatus('error', '✗', result?.error || 'Cleanup failed.');
    }
  } catch (err) {
    showStatus('error', '✗', err.message);
  } finally {
    state.isBusy = false;
    setActionButtonsDisabled(false);
  }
}

async function deleteSavedSite(id) {
  state.savedSites = state.savedSites.filter(s => s.id !== id);
  await chromeStorageSet({ savedSites: state.savedSites });
  renderSavedSites();
  // Notify background to update badge
  sendMessage({ type: 'SET_BADGE', payload: {} });
}

// Quick-save the current site using auto-detected info
async function onQuickSaveSite() {
  if (!state.tabInfo?.valid) return;

  // Check if already saved
  const exists = state.savedSites.find(s => {
    try {
      const u = new URL(normalizeDomain(s.domain));
      return u.hostname === state.tabInfo.hostname;
    } catch { return false; }
  });

  if (exists) {
    showStatus('partial', 'ℹ', 'This site is already in your saved list.');
    return;
  }

  // Pre-populate and open editor
  openSiteEditor(null, {
    name:   state.tabInfo.hostname,
    domain: state.tabInfo.origin,
    env:    'DEV',
    notes:  ''
  });
}

// ═══════════════════════════════════════════════════════════════════
// 11. SITE EDITOR MODAL
// ═══════════════════════════════════════════════════════════════════
function openSiteEditor(site, prefill = null) {
  state.editingSiteId = site?.id || null;
  DOM.modalTitle.textContent = site ? 'Edit Site' : 'Add Saved Site';

  // Populate fields
  DOM.fieldName.value   = site?.name   || prefill?.name   || '';
  DOM.fieldDomain.value = site?.domain || prefill?.domain || '';
  DOM.fieldEnv.value    = site?.env    || prefill?.env    || 'DEV';
  DOM.fieldNotes.value  = site?.notes  || prefill?.notes  || '';
  DOM.errName.textContent   = '';
  DOM.errDomain.textContent = '';
  DOM.fieldName.classList.remove('invalid');
  DOM.fieldDomain.classList.remove('invalid');

  DOM.modalSiteEditor.hidden = false;
  DOM.fieldName.focus();
}

function closeSiteEditor() {
  DOM.modalSiteEditor.hidden = true;
  state.editingSiteId = null;
}

async function onSiteEditorSubmit(e) {
  e.preventDefault();

  const name   = DOM.fieldName.value.trim();
  const domain = DOM.fieldDomain.value.trim();
  const env    = DOM.fieldEnv.value;
  const notes  = DOM.fieldNotes.value.trim();

  // Validate
  let valid = true;
  if (!name) {
    DOM.errName.textContent = 'Name is required.';
    DOM.fieldName.classList.add('invalid');
    valid = false;
  } else {
    DOM.errName.textContent = '';
    DOM.fieldName.classList.remove('invalid');
  }

  const normalizedDomain = normalizeDomain(domain);
  try {
    new URL(normalizedDomain);
    DOM.errDomain.textContent = '';
    DOM.fieldDomain.classList.remove('invalid');
  } catch {
    DOM.errDomain.textContent = 'Enter a valid URL (e.g. https://dev.example.com).';
    DOM.fieldDomain.classList.add('invalid');
    valid = false;
  }

  if (!valid) return;

  if (state.editingSiteId) {
    // Update existing
    const idx = state.savedSites.findIndex(s => s.id === state.editingSiteId);
    if (idx !== -1) {
      state.savedSites[idx] = { ...state.savedSites[idx], name, domain: normalizedDomain, env, notes };
    }
  } else {
    // Add new
    const newSite = {
      id: generateId(),
      name,
      domain: normalizedDomain,
      env,
      notes,
      createdAt: Date.now()
    };
    state.savedSites.push(newSite);
  }

  await chromeStorageSet({ savedSites: state.savedSites });
  closeSiteEditor();
  renderSavedSites();
}

// ═══════════════════════════════════════════════════════════════════
// 12. HISTORY PANEL
// ═══════════════════════════════════════════════════════════════════
function renderHistory() {
  DOM.historyList.innerHTML = '';

  if (state.history.length === 0) {
    DOM.historyEmpty.hidden = false;
    return;
  }
  DOM.historyEmpty.hidden = true;

  // Show up to 10 recent entries in the popup
  const entries = state.history.slice(0, 10);
  entries.forEach(record => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.setAttribute('role', 'listitem');

    const domain = document.createElement('span');
    domain.className = 'history-domain';
    domain.textContent = record.hostname || record.origin || '—';
    domain.title = record.origin || '';

    const types = document.createElement('span');
    types.className = 'history-types';
    types.textContent = (record.dataTypes || []).join(', ');

    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = formatRelativeTime(record.timestamp);
    time.title = new Date(record.timestamp).toLocaleString();

    item.append(domain, types, time);
    DOM.historyList.appendChild(item);
  });
}

async function onClearHistory() {
  state.history = [];
  await chromeStorageSet({ history: [] });
  renderHistory();
}

// ═══════════════════════════════════════════════════════════════════
// 13. THEME MANAGEMENT
// ═══════════════════════════════════════════════════════════════════
function applyTheme(theme) {
  state.theme = theme;
  DOM.body.classList.toggle('theme-dark',  theme === 'dark');
  DOM.body.classList.toggle('theme-light', theme !== 'dark');
  DOM.iconSun.style.display  = theme === 'dark'  ? 'block' : 'none';
  DOM.iconMoon.style.display = theme === 'light' ? 'block' : 'none';
}

async function toggleTheme() {
  const next = state.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  await chromeStorageSet({ theme: next });
}

// ═══════════════════════════════════════════════════════════════════
// 14. URL COPY
// ═══════════════════════════════════════════════════════════════════
async function onCopyUrl() {
  if (!state.tabInfo?.url) return;
  try {
    await navigator.clipboard.writeText(state.tabInfo.url);
    showToast('URL copied!');
  } catch {
    // Clipboard API may be restricted in extension contexts on some builds
    showStatus('error', '✗', 'Could not copy to clipboard.');
  }
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'copy-success';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}

// ═══════════════════════════════════════════════════════════════════
// 15. OPTIONS PAGE
// ═══════════════════════════════════════════════════════════════════
// Handled inline via chrome.runtime.openOptionsPage() in the listener above.

// ═══════════════════════════════════════════════════════════════════
// 16. UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Sends a message to the background service worker.
 * Returns null on failure instead of throwing.
 */
async function sendMessage(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (err) {
    console.error('[QA Cache Cleaner] sendMessage failed:', err.message);
    return null;
  }
}

/**
 * Promisified chrome.storage.local.get
 */
function chromeStorageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

/**
 * Promisified chrome.storage.local.set
 */
function chromeStorageSet(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

/**
 * Ensures a domain string has a protocol prefix.
 */
function normalizeDomain(domain) {
  if (!domain) return '';
  domain = domain.trim();
  if (/^https?:\/\//i.test(domain)) return domain;
  return 'https://' + domain;
}

/**
 * Generates a simple unique ID for saved sites.
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Safely escape HTML for innerHTML usage.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);
