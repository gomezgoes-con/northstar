/**
 * Global Query State Management
 * Handles:
 * - Central query storage
 * - URL hash encoding/decoding for sharing
 * - localStorage persistence
 * - State change notifications to all tabs
 */

const STORAGE_KEY = 'northstar_query';
const URL_HASH_PREFIX = 'q=';

// Current query JSON
let currentQuery = null;

// Listeners for state changes
const listeners = [];

/**
 * Initialize query state from URL or localStorage
 */
export function initQueryState() {
  // Priority 1: Check URL hash
  const hashQuery = loadFromHash();
  if (hashQuery) {
    currentQuery = hashQuery;
    saveToLocalStorage();
    notifyListeners();
    return true;
  }

  // Priority 2: Check localStorage
  const storedQuery = loadFromLocalStorage();
  if (storedQuery) {
    currentQuery = storedQuery;
    notifyListeners();
    return true;
  }

  return false;
}

/**
 * Get the current query
 */
export function getQuery() {
  return currentQuery;
}

/**
 * Set a new query (from file upload or other source)
 */
export function setQuery(queryJson) {
  currentQuery = queryJson;

  // Persist to localStorage
  saveToLocalStorage();

  // Update URL hash
  updateHash();

  // Notify all listeners
  notifyListeners();
}

/**
 * Clear the current query
 */
export function clearQuery() {
  currentQuery = null;
  localStorage.removeItem(STORAGE_KEY);
  clearHash();
  notifyListeners();
}

/**
 * Add a listener for query changes
 * Listener will be called with the new query (or null if cleared)
 */
export function addListener(callback) {
  listeners.push(callback);
}

/**
 * Remove a listener
 */
export function removeListener(callback) {
  const index = listeners.indexOf(callback);
  if (index > -1) {
    listeners.splice(index, 1);
  }
}

/**
 * Notify all listeners of state change
 */
function notifyListeners() {
  listeners.forEach(callback => {
    try {
      callback(currentQuery);
    } catch (error) {
      console.error('Error in query state listener:', error);
    }
  });
}

/**
 * Save query to localStorage
 */
function saveToLocalStorage() {
  if (!currentQuery) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  try {
    const jsonString = JSON.stringify(currentQuery);
    localStorage.setItem(STORAGE_KEY, jsonString);
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
  }
}

/**
 * Load query from localStorage
 */
function loadFromLocalStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load from localStorage:', error);
  }
  return null;
}

/**
 * Update URL hash with current query
 * Uses LZ-String compression + URI encoding for short URLs
 */
function updateHash() {
  if (!currentQuery) {
    clearHash();
    return;
  }

  try {
    const jsonString = JSON.stringify(currentQuery);
    // Use LZString compression (like Excalidraw) for much shorter URLs
    const compressed = LZString.compressToEncodedURIComponent(jsonString);
    window.history.replaceState(null, '', `#${URL_HASH_PREFIX}${compressed}`);
  } catch (error) {
    console.error('Failed to encode query in URL:', error);
    clearHash();
  }
}

/**
 * Load query from URL hash
 */
function loadFromHash() {
  try {
    const hash = window.location.hash;
    if (!hash || !hash.startsWith(`#${URL_HASH_PREFIX}`)) {
      return null;
    }

    const compressed = hash.substring(URL_HASH_PREFIX.length + 1);

    // Decompress using LZString
    const jsonString = LZString.decompressFromEncodedURIComponent(compressed);

    if (!jsonString) {
      console.error('Failed to decompress query from URL');
      return null;
    }

    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Failed to decode query from URL:', error);
    return null;
  }
}

/**
 * Clear URL hash
 */
function clearHash() {
  window.history.replaceState(null, '', window.location.pathname);
}

/**
 * Check if a query is currently loaded
 */
export function hasQuery() {
  return currentQuery !== null;
}

/**
 * Get a shareable URL for the current query
 */
export function getShareableUrl() {
  if (!currentQuery) {
    return window.location.origin + window.location.pathname;
  }
  return window.location.href;
}
