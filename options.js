/**
 * options.js – QA Cache Cleaner Options Page
 *
 * Handles:
 *  - Tab navigation
 *  - Loading/saving preferences
 *  - Theme toggle
 *  - Export/import saved sites
 *  - Nuclear "delete all data" action
 */

'use strict';

// ── DOM ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const DOM = {
  body:            $('body'),
  btnTheme:        $('btn-theme'),
  iconSun:         $('icon-sun'),
  iconMoon:        $('icon-moon'),
  navTabs:         document.querySelectorAll('.nav-tab'),
  tabContents:     document.querySelectorAll('.tab-content'),

  // General
  prefTheme:       $('pref-theme'),
  prefSince:       $('pref-since'),
  prefPreserveLogin: $('pref-preserve-login'),
  prefCacheStorage:  $('pref-cache-storage'),
  prefHistoryMax:  $('pref-history-max'),
  btnSave:         $('btn-save'),
  saveStatus:      $('save-status'),

  // Shortcuts
  btnManageShortcuts: $('btn-manage-shortcuts'),

  // Data
  btnExportSites:  $('btn-export-sites'),
  btnImportSites:  $('btn-import-sites'),
  importFile:      $('import-file'),
  btnNukeAll:      $('btn-nuke-all'),
  dataStatus:      $('data-status'),
};

// ── State ─────────────────────────────────────────────────────────
let currentTheme = 'light';

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  await loadPreferences();
  attachListeners();
}

async function loadPreferences() {
  const data = await storageGet(['theme', 'preferences']);
  const prefs = data.preferences || {};
  currentTheme = data.theme || 'light';

  applyTheme(currentTheme);

  // Populate fields
  DOM.prefTheme.value               = currentTheme;
  DOM.prefSince.value               = String(prefs.defaultSince        ?? 0);
  DOM.prefPreserveLogin.checked     = prefs.preserveLogin !== false;   // default true
  DOM.prefCacheStorage.checked      = prefs.autoClearCacheStorage !== false; // default true
  DOM.prefHistoryMax.value          = String(prefs.historyMax           ?? 50);
}

function attachListeners() {
  // Tab navigation
  DOM.navTabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Theme toggle button (header)
  DOM.btnTheme.addEventListener('click', toggleTheme);

  // Save button
  DOM.btnSave.addEventListener('click', savePreferences);

  // Theme select also immediately applies
  DOM.prefTheme.addEventListener('change', () => {
    applyTheme(DOM.prefTheme.value);
  });

  // Data actions
  DOM.btnExportSites.addEventListener('click', exportSites);
  DOM.btnImportSites.addEventListener('click', () => DOM.importFile.click());
  DOM.importFile.addEventListener('change', importSites);
  DOM.btnNukeAll.addEventListener('click', nukeAllData);

  // Shortcuts link – prevent navigation (it's chrome:// which can't be used in anchor href from options page)
  DOM.btnManageShortcuts?.addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

// ── Tab navigation ─────────────────────────────────────────────────
function switchTab(tabId) {
  DOM.navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  DOM.tabContents.forEach(tc => {
    tc.hidden = tc.id !== `tab-${tabId}`;
  });
}

// ── Theme ──────────────────────────────────────────────────────────
function applyTheme(theme) {
  currentTheme = theme;
  DOM.body.classList.toggle('theme-dark',  theme === 'dark');
  DOM.body.classList.toggle('theme-light', theme !== 'dark');
  DOM.iconSun.style.display  = theme === 'dark'  ? 'block' : 'none';
  DOM.iconMoon.style.display = theme === 'light' ? 'block' : 'none';
}

async function toggleTheme() {
  const next = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  DOM.prefTheme.value = next;
}

// ── Save preferences ───────────────────────────────────────────────
async function savePreferences() {
  const theme = DOM.prefTheme.value;
  const prefs = {
    defaultSince:           parseInt(DOM.prefSince.value, 10),
    preserveLogin:          DOM.prefPreserveLogin.checked,
    autoClearCacheStorage:  DOM.prefCacheStorage.checked,
    historyMax:             parseInt(DOM.prefHistoryMax.value, 10)
  };

  applyTheme(theme);

  try {
    await storageSet({ theme, preferences: prefs });
    DOM.saveStatus.hidden = false;
    setTimeout(() => { DOM.saveStatus.hidden = true; }, 2500);
  } catch (err) {
    alert('Failed to save settings: ' + err.message);
  }
}

// ── Export saved sites ─────────────────────────────────────────────
async function exportSites() {
  const { savedSites = [] } = await storageGet(['savedSites']);
  const json = JSON.stringify({ version: 1, savedSites }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `qa-cache-cleaner-sites-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showDataStatus('ok', `Exported ${savedSites.length} site(s).`);
}

// ── Import saved sites ─────────────────────────────────────────────
async function importSites(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (!parsed.savedSites || !Array.isArray(parsed.savedSites)) {
      throw new Error('Invalid format: missing "savedSites" array.');
    }

    // Validate each entry
    const imported = parsed.savedSites.filter(s =>
      s && typeof s.name === 'string' && typeof s.domain === 'string'
    );

    if (imported.length === 0) {
      throw new Error('No valid sites found in the file.');
    }

    // Merge: avoid duplicates by domain
    const { savedSites: existing = [] } = await storageGet(['savedSites']);
    const merged = [...existing];
    let added = 0;

    for (const site of imported) {
      const dup = merged.find(s => s.domain === site.domain);
      if (!dup) {
        merged.push({ ...site, id: site.id || generateId(), importedAt: Date.now() });
        added++;
      }
    }

    await storageSet({ savedSites: merged });
    showDataStatus('ok', `Imported ${added} new site(s). ${imported.length - added} duplicate(s) skipped.`);
  } catch (err) {
    showDataStatus('err', 'Import failed: ' + err.message);
  } finally {
    // Reset file input so same file can be re-selected
    DOM.importFile.value = '';
  }
}

// ── Nuclear delete ─────────────────────────────────────────────────
async function nukeAllData() {
  const confirmed = confirm(
    '⚠ Delete ALL QA Cache Cleaner data?\n\n' +
    'This will permanently remove:\n' +
    '  • All saved sites\n' +
    '  • All cleanup history\n' +
    '  • All preferences\n\n' +
    'This cannot be undone.'
  );
  if (!confirmed) return;

  try {
    await new Promise((resolve, reject) => {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
    showDataStatus('ok', 'All extension data deleted. Reload the page to reset the UI.');
    // Reset UI to defaults
    await loadPreferences();
  } catch (err) {
    showDataStatus('err', 'Delete failed: ' + err.message);
  }
}

// ── Helpers ────────────────────────────────────────────────────────
function showDataStatus(type, msg) {
  DOM.dataStatus.hidden  = false;
  DOM.dataStatus.className = `data-status ${type}`;
  DOM.dataStatus.textContent = msg;
  setTimeout(() => { DOM.dataStatus.hidden = true; }, 5000);
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

function storageSet(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Boot ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
