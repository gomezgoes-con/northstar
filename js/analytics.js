/**
 * Privacy-respecting analytics via GoatCounter
 * No cookies, no personal data, no consent popup needed
 */

/**
 * Track a custom event
 * @param {string} eventName - Name of the event (e.g., 'upload-scan', 'tab-join')
 */
export function trackEvent(eventName) {
  if (typeof window.goatcounter === 'undefined' || !window.goatcounter.count) {
    return;
  }

  window.goatcounter.count({
    path: eventName,
    event: true
  });
}
