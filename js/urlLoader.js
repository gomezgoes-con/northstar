/**
 * URL Loader - Handle loading queries from external sources
 * Supports: GitHub Gist, dpaste.com, raw JSON URLs
 */

/**
 * Load query from a URL
 */
export async function loadFromUrl(url) {
  // Detect URL type and load accordingly
  if (url.includes('gist.github.com')) {
    return await loadFromGist(url);
  } else if (url.includes('dpaste.com')) {
    return await loadFromDpaste(url);
  } else {
    // Try loading as raw JSON
    return await loadFromRawUrl(url);
  }
}

/**
 * Load from GitHub Gist
 */
async function loadFromGist(url) {
  // Extract gist ID from URL
  // Format: https://gist.github.com/username/gist_id
  const match = url.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/);
  if (!match) {
    throw new Error('Invalid Gist URL format');
  }

  const gistId = match[1];

  // Fetch gist via GitHub API
  const response = await fetch(`https://api.github.com/gists/${gistId}`);
  if (!response.ok) {
    throw new Error(`Failed to load Gist: ${response.statusText}`);
  }

  const gist = await response.json();

  // Find the first JSON file in the gist
  const files = Object.values(gist.files);
  const jsonFile = files.find(f => f.filename.endsWith('.json'));

  if (!jsonFile) {
    throw new Error('No JSON file found in Gist');
  }

  // Parse and return the query
  return JSON.parse(jsonFile.content);
}

/**
 * Load from dpaste.com
 */
async function loadFromDpaste(url) {
  // Add .txt to get raw content if not present
  const rawUrl = url.endsWith('.txt') ? url : `${url}.txt`;

  const response = await fetch(rawUrl);
  if (!response.ok) {
    throw new Error(`Failed to load paste: ${response.statusText}`);
  }

  const content = await response.text();
  return JSON.parse(content);
}

/**
 * Load from raw JSON URL
 */
async function loadFromRawUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load URL: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Share query by creating a paste on dpaste.com
 * Returns the paste URL
 */
export async function shareToDpaste(queryJson) {
  const jsonString = JSON.stringify(queryJson, null, 2);

  // Create form data for dpaste API
  const formData = new FormData();
  formData.append('content', jsonString);
  formData.append('syntax', 'json');
  formData.append('expiry_days', '365'); // 1 year expiry

  const response = await fetch('https://dpaste.com/api/', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Failed to create paste: ${response.statusText}`);
  }

  // dpaste returns the URL in the response text
  const pasteUrl = (await response.text()).trim();
  return pasteUrl;
}

/**
 * Parse a NorthStar URL and extract the external URL reference
 * Format: http://localhost:8000/#gist:ID or #paste:ID
 */
export function parseNorthStarUrl(hash) {
  if (!hash) return null;

  // Remove leading #
  hash = hash.replace(/^#/, '');

  // Check for gist: or paste: prefix
  if (hash.startsWith('gist:')) {
    const gistId = hash.substring(5);
    return {
      type: 'gist',
      id: gistId,
      url: `https://gist.github.com/${gistId}` // Will need to fetch to get full URL
    };
  }

  if (hash.startsWith('paste:')) {
    const pasteId = hash.substring(6);
    return {
      type: 'paste',
      id: pasteId,
      url: `https://dpaste.com/${pasteId}`
    };
  }

  return null;
}
