// Simple analytics tracking
// Can be extended with Google Analytics, Plausible, PostHog, etc.

type AnalyticsEvent = {
  event: string;
  properties?: Record<string, unknown>;
};

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  // In production, send to analytics service
  // For now, just log to console in development
  if (import.meta.env.DEV) {
    console.log('[Analytics]', event, properties);
  }

  // Example: Send to analytics service
  // if (window.gtag) {
  //   window.gtag('event', event, properties);
  // }
}

export function trackPageView(path: string) {
  trackEvent('page_view', { path });
}

export function trackUserAction(action: string, properties?: Record<string, unknown>) {
  trackEvent('user_action', { action, ...properties });
}
