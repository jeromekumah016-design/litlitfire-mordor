/**
 * Web Vitals Monitoring Service
 * Tracks Core Web Vitals: LCP, FID, CLS, FCP, TTFB
 */

export interface WebVital {
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  delta: number;
  id: string;
  navigationType: string;
}

interface WebVitalsMetrics {
  LCP?: WebVital; // Largest Contentful Paint
  FID?: WebVital; // First Input Delay
  CLS?: WebVital; // Cumulative Layout Shift
  FCP?: WebVital; // First Contentful Paint
  TTFB?: WebVital; // Time to First Byte
}

class WebVitalsMonitor {
  private metrics: WebVitalsMetrics = {};
  private observers: Map<string, PerformanceObserver> = new Map();

  /**
   * Initialize Web Vitals monitoring
   */
  init(): void {
    this.observeLCP();
    this.observeFID();
    this.observeCLS();
    this.observeFCP();
    this.observeTTFB();
  }

  /**
   * Observe Largest Contentful Paint (LCP)
   */
  private observeLCP(): void {
    if (!("PerformanceObserver" in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1] as any;
        this.metrics.LCP = {
          name: "LCP",
          value: lastEntry.renderTime || lastEntry.loadTime,
          rating: this.getRating("LCP", lastEntry.renderTime || lastEntry.loadTime),
          delta: 0,
          id: `lcp-${Date.now()}`,
          navigationType: "navigation",
        };
      });

      observer.observe({ entryTypes: ["largest-contentful-paint"] });
      this.observers.set("LCP", observer);
    } catch (e) {
      console.warn("LCP observer failed:", e);
    }
  }

  /**
   * Observe First Input Delay (FID)
   */
  private observeFID(): void {
    if (!("PerformanceObserver" in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry: any) => {
          this.metrics.FID = {
            name: "FID",
            value: entry.processingDuration,
            rating: this.getRating("FID", entry.processingDuration),
            delta: 0,
            id: `fid-${Date.now()}`,
            navigationType: "navigation",
          };
        });
      });

      observer.observe({ entryTypes: ["first-input"] });
      this.observers.set("FID", observer);
    } catch (e) {
      console.warn("FID observer failed:", e);
    }
  }

  /**
   * Observe Cumulative Layout Shift (CLS)
   */
  private observeCLS(): void {
    if (!("PerformanceObserver" in window)) return;

    try {
      let clsValue = 0;
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry: any) => {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
            this.metrics.CLS = {
              name: "CLS",
              value: clsValue,
              rating: this.getRating("CLS", clsValue),
              delta: entry.value,
              id: `cls-${Date.now()}`,
              navigationType: "navigation",
            };
          }
        });
      });

      observer.observe({ entryTypes: ["layout-shift"] });
      this.observers.set("CLS", observer);
    } catch (e) {
      console.warn("CLS observer failed:", e);
    }
  }

  /**
   * Observe First Contentful Paint (FCP)
   */
  private observeFCP(): void {
    if (!("PerformanceObserver" in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        this.metrics.FCP = {
          name: "FCP",
          value: lastEntry.startTime,
          rating: this.getRating("FCP", lastEntry.startTime),
          delta: 0,
          id: `fcp-${Date.now()}`,
          navigationType: "navigation",
        };
      });

      observer.observe({ entryTypes: ["paint"] });
      this.observers.set("FCP", observer);
    } catch (e) {
      console.warn("FCP observer failed:", e);
    }
  }

  /**
   * Observe Time to First Byte (TTFB)
   */
  private observeTTFB(): void {
    try {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      if (navigation) {
        this.metrics.TTFB = {
          name: "TTFB",
          value: navigation.responseStart - navigation.fetchStart,
          rating: this.getRating("TTFB", navigation.responseStart - navigation.fetchStart),
          delta: 0,
          id: `ttfb-${Date.now()}`,
          navigationType: "navigation",
        };
      }
    } catch (e) {
      console.warn("TTFB observer failed:", e);
    }
  }

  /**
   * Get rating for a metric based on thresholds
   */
  private getRating(metric: string, value: number): "good" | "needs-improvement" | "poor" {
    const thresholds: Record<string, [number, number]> = {
      LCP: [2500, 4000],
      FID: [100, 300],
      CLS: [0.1, 0.25],
      FCP: [1800, 3000],
      TTFB: [600, 1200],
    };

    const [good, poor] = thresholds[metric] || [0, Infinity];
    if (value <= good) return "good";
    if (value <= poor) return "needs-improvement";
    return "poor";
  }

  /**
   * Get all metrics
   */
  getMetrics(): WebVitalsMetrics {
    return this.metrics;
  }

  /**
   * Get specific metric
   */
  getMetric(name: keyof WebVitalsMetrics): WebVital | undefined {
    return this.metrics[name];
  }

  /**
   * Send metrics to analytics endpoint
   */
  async sendMetrics(endpoint: string): Promise<void> {
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.metrics),
        keepalive: true,
      });
    } catch (e) {
      console.warn("Failed to send Web Vitals metrics:", e);
    }
  }

  /**
   * Clean up observers
   */
  cleanup(): void {
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
  }
}

export const webVitalsMonitor = new WebVitalsMonitor();

/**
 * Hook to use Web Vitals monitoring
 */
export function useWebVitals() {
  return {
    metrics: webVitalsMonitor.getMetrics(),
    getMetric: (name: keyof WebVitalsMetrics) => webVitalsMonitor.getMetric(name),
    sendMetrics: (endpoint: string) => webVitalsMonitor.sendMetrics(endpoint),
  };
}
