/**
 * Raw JSON Tab - Display, search, and collapsible tree functionality
 */

import { getQuery } from './queryState.js';

// DOM Elements
const rawDropZone = document.getElementById('rawDropZone');
const rawContainer = document.getElementById('rawContainer');
const rawJsonContent = document.getElementById('rawJsonContent');
const btnCopyRaw = document.getElementById('btnCopyRaw');
const rawSearchInput = document.getElementById('rawSearchInput');
const rawSearchCount = document.getElementById('rawSearchCount');
const rawSearchPrev = document.getElementById('rawSearchPrev');
const rawSearchNext = document.getElementById('rawSearchNext');

// State
let rawJsonText = '';
let currentJson = null;
let searchMatches = [];
let currentMatchIndex = -1;
let searchTimeout;
let isTreeView = true;

/**
 * Initialize Raw JSON tab event listeners
 */
export function initRawJson() {
  // Drop zone click opens Load Query modal
  rawDropZone.addEventListener('click', () => {
    if (window.showLoadModal) window.showLoadModal();
  });

  // Drop zone drag and drop
  rawDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    rawDropZone.classList.add('drag-over');
  });

  rawDropZone.addEventListener('dragleave', () => {
    rawDropZone.classList.remove('drag-over');
  });

  rawDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    rawDropZone.classList.remove('drag-over');
    // File handling is done by the global file input
  });

  // Copy button
  btnCopyRaw.addEventListener('click', handleCopy);

  // Search input with debounce
  rawSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch(e.target.value);
    }, 150);
  });

  // Keyboard navigation in search input
  rawSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      rawSearchInput.value = '';
      performSearch('');
      rawSearchInput.blur();
    }
  });

  // Navigation buttons
  rawSearchPrev.addEventListener('click', () => navigateMatch(-1));
  rawSearchNext.addEventListener('click', () => navigateMatch(1));

  // Delegate click events for tree toggle
  rawJsonContent.addEventListener('click', handleTreeClick);
}

/**
 * Update the Raw JSON tab with formatted JSON
 */
export function updateRawTab(json) {
  const formatted = JSON.stringify(json, null, 2);
  rawJsonText = formatted;
  currentJson = json;
  isTreeView = true;

  renderTreeView(json);
  clearSearchState();

  // Show container, hide drop zone
  rawDropZone.style.display = 'none';
  rawContainer.style.display = 'block';
}

/**
 * Clear/reset the Raw JSON tab
 */
export function clearRawTab() {
  rawJsonText = '';
  currentJson = null;
  rawJsonContent.innerHTML = '<code></code>';
  clearSearchState();

  // Show drop zone, hide container
  rawDropZone.style.display = 'block';
  rawContainer.style.display = 'none';
}

/**
 * Programmatically search for a term in the Raw JSON
 * @param {string} term - The search term
 */
export function searchFor(term) {
  if (!rawJsonText || !term) return;

  rawSearchInput.value = term;
  performSearch(term);
}

// ========================================
// Tree View Rendering
// ========================================

/**
 * Render JSON as a collapsible tree
 */
function renderTreeView(json) {
  const html = renderValue(json, '', 0, true);
  rawJsonContent.innerHTML = `<code class="json-tree">${html}</code>`;
}

/**
 * Render a JSON value (recursive)
 */
function renderValue(value, key, depth, isLast) {
  const indent = '  '.repeat(depth);
  const keyHtml = key ? `<span class="json-key">"${escapeHtml(key)}"</span>: ` : '';
  const comma = isLast ? '' : ',';

  if (value === null) {
    return `${indent}${keyHtml}<span class="json-null">null</span>${comma}\n`;
  }

  if (typeof value === 'boolean') {
    return `${indent}${keyHtml}<span class="json-boolean">${value}</span>${comma}\n`;
  }

  if (typeof value === 'number') {
    return `${indent}${keyHtml}<span class="json-number">${value}</span>${comma}\n`;
  }

  if (typeof value === 'string') {
    // Truncate very long strings in display (full value still in data attribute)
    const displayStr = value.length > 500 ? value.substring(0, 500) + '...' : value;
    return `${indent}${keyHtml}<span class="json-string">"${escapeHtml(displayStr)}"</span>${comma}\n`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}${keyHtml}<span class="json-bracket">[]</span>${comma}\n`;
    }

    const id = generateId();
    const preview = `Array(${value.length})`;
    let html = `${indent}${keyHtml}<span class="json-toggle" data-id="${id}">▼</span> <span class="json-bracket">[</span> <span class="json-preview">${preview}</span>\n`;
    html += `<span class="json-collapsible" data-id="${id}">`;

    value.forEach((item, index) => {
      html += renderValue(item, '', depth + 1, index === value.length - 1);
    });

    html += `${indent}<span class="json-bracket">]</span>${comma}</span>\n`;
    return html;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return `${indent}${keyHtml}<span class="json-bracket">{}</span>${comma}\n`;
    }

    const id = generateId();
    // Create a preview of first few keys
    const previewKeys = keys.slice(0, 3).map(k => `"${k}"`).join(', ');
    const preview = keys.length > 3 ? `${previewKeys}, ...` : previewKeys;

    let html = `${indent}${keyHtml}<span class="json-toggle" data-id="${id}">▼</span> <span class="json-bracket">{</span> <span class="json-preview">${escapeHtml(preview)}</span>\n`;
    html += `<span class="json-collapsible" data-id="${id}">`;

    keys.forEach((k, index) => {
      html += renderValue(value[k], k, depth + 1, index === keys.length - 1);
    });

    html += `${indent}<span class="json-bracket">}</span>${comma}</span>\n`;
    return html;
  }

  return `${indent}${keyHtml}${escapeHtml(String(value))}${comma}\n`;
}

let idCounter = 0;
function generateId() {
  return `json-node-${idCounter++}`;
}

/**
 * Handle click on tree toggle
 */
function handleTreeClick(e) {
  const toggle = e.target.closest('.json-toggle');
  if (!toggle) return;

  const id = toggle.dataset.id;
  const collapsible = rawJsonContent.querySelector(`.json-collapsible[data-id="${id}"]`);
  if (!collapsible) return;

  const isCollapsed = collapsible.classList.contains('collapsed');

  if (isCollapsed) {
    collapsible.classList.remove('collapsed');
    toggle.textContent = '▼';
    toggle.classList.remove('collapsed');
  } else {
    collapsible.classList.add('collapsed');
    toggle.textContent = '▶';
    toggle.classList.add('collapsed');
  }
}

// ========================================
// Search Functions
// ========================================

function clearSearchState() {
  rawSearchInput.value = '';
  rawSearchCount.textContent = '';
  searchMatches = [];
  currentMatchIndex = -1;
}

function handleCopy() {
  const query = getQuery();
  if (!query) {
    alert('No query loaded to copy');
    return;
  }

  const jsonString = JSON.stringify(query, null, 2);
  navigator.clipboard.writeText(jsonString).then(() => {
    const originalText = btnCopyRaw.textContent;
    btnCopyRaw.textContent = '✓ Copied!';
    setTimeout(() => {
      btnCopyRaw.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy JSON:', err);
    alert('Failed to copy JSON to clipboard');
  });
}

function performSearch(query) {
  if (!rawJsonText || !query) {
    // Restore tree view when search is cleared
    if (currentJson) {
      renderTreeView(currentJson);
    }
    rawSearchCount.textContent = '';
    searchMatches = [];
    currentMatchIndex = -1;
    return;
  }

  // Switch to flat view for search (easier to highlight matches)
  isTreeView = false;

  // Find all matches (case-insensitive)
  const regex = new RegExp(escapeRegex(query), 'gi');
  searchMatches = [];
  let match;
  while ((match = regex.exec(rawJsonText)) !== null) {
    searchMatches.push({ start: match.index, end: match.index + match[0].length });
  }

  if (searchMatches.length === 0) {
    rawJsonContent.innerHTML = `<code>${escapeHtml(rawJsonText)}</code>`;
    rawSearchCount.textContent = '0 results';
    currentMatchIndex = -1;
    return;
  }

  currentMatchIndex = 0;
  highlightMatches();
}

function highlightMatches() {
  if (searchMatches.length === 0) return;

  let html = '';
  let lastEnd = 0;

  searchMatches.forEach((match, idx) => {
    html += escapeHtml(rawJsonText.slice(lastEnd, match.start));
    const matchText = rawJsonText.slice(match.start, match.end);
    const isCurrent = idx === currentMatchIndex;
    html += `<span class="search-highlight${isCurrent ? ' current' : ''}" data-match="${idx}">${escapeHtml(matchText)}</span>`;
    lastEnd = match.end;
  });
  html += escapeHtml(rawJsonText.slice(lastEnd));

  rawJsonContent.innerHTML = `<code>${html}</code>`;
  rawSearchCount.textContent = `${currentMatchIndex + 1} / ${searchMatches.length}`;

  // Scroll current match into view
  const currentEl = rawJsonContent.querySelector('.search-highlight.current');
  if (currentEl) {
    currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function navigateMatch(delta) {
  if (searchMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + delta + searchMatches.length) % searchMatches.length;
  highlightMatches();
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
