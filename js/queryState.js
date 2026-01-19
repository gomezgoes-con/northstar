/**
 * Global Query State Management
 * Handles:
 * - Central query storage
 * - External URL references (gist/paste)
 * - State change notifications to all tabs
 *
 * Note: No localStorage persistence - queries live in external services
 */

import { loadFromUrl, parseNorthStarUrl } from './urlLoader.js';

// Current query JSON
let currentQuery = null;

// Query source info (for reusing on share)
let querySource = null; // { type: 'gist|paste', id: '...', url: '...' }

// Listeners for state changes
const listeners = [];

/**
 * Initialize query state from URL only
 * Checks for #gist:ID or #paste:ID format
 */
export async function initQueryState() {
  const hash = window.location.hash;
  if (!hash) return false;

  try {
    const parsed = parseNorthStarUrl(hash);
    if (parsed) {
      // Load from external URL (gist or paste)
      const query = await loadFromUrl(parsed.url);
      currentQuery = query;
      querySource = parsed; // Store source for reuse
      notifyListeners();
      return true;
    }
  } catch (error) {
    console.error('Failed to load query from URL:', error);
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
 * @param {Object} queryJson - The query data
 * @param {Object} source - Optional source info { type, id, url }
 */
export function setQuery(queryJson, source = null) {
  currentQuery = queryJson;
  querySource = source;

  // Update URL if source is provided
  if (source && (source.type === 'gist' || source.type === 'paste')) {
    const newUrl = `${window.location.origin}${window.location.pathname}#${source.type}:${source.id}`;
    window.history.replaceState(null, '', newUrl);
  }

  // Notify all listeners
  notifyListeners();
}

/**
 * Get the query source (for reusing on share)
 */
export function getQuerySource() {
  return querySource;
}

/**
 * Clear the current query
 */
export function clearQuery() {
  currentQuery = null;
  querySource = null;
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
 * This is now handled by the Share button which creates a paste
 */
export function getShareableUrl() {
  // This function is no longer used - sharing is done via dpaste
  return window.location.href;
}
