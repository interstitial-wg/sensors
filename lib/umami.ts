/**
 * Umami Analytics event tracking.
 * Use in client components only – window.umami is available after the script loads.
 *
 * @example
 * // Simple event
 * trackEvent('filter-applied');
 *
 * @example
 * // Event with data (numbers, booleans, strings supported)
 * trackEvent('sensor-selected', { sensorId: 'abc123', type: 'temperature' });
 */

declare global {
  interface Window {
    umami?: {
      track: (eventName: string, eventData?: Record<string, unknown>) => void;
    };
  }
}

/**
 * Track a custom event in Umami.
 * No-op if Umami is not loaded (e.g. dev without env var).
 *
 * @param eventName - Event name (max 50 chars)
 * @param eventData - Optional data (strings max 500 chars, objects max 50 props)
 */
export function trackEvent(
  eventName: string,
  eventData?: Record<string, string | number | boolean>,
): void {
  if (typeof window === "undefined") return;
  if (!window.umami?.track) return;

  try {
    if (eventData && Object.keys(eventData).length > 0) {
      window.umami.track(eventName, eventData);
    } else {
      window.umami.track(eventName);
    }
  } catch {
    // Silently ignore tracking errors
  }
}
