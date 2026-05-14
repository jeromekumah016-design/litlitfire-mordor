/**
 * Hook to initialize Web Vitals monitoring
 */

import { useEffect } from "react";
import { webVitalsMonitor } from "../services/webVitalsMonitor";

export function useWebVitalsInit(metricsEndpoint?: string) {
  useEffect(() => {
    // Initialize Web Vitals monitoring
    webVitalsMonitor.init();

    // Send metrics to endpoint if provided
    if (metricsEndpoint) {
      const interval = setInterval(() => {
        webVitalsMonitor.sendMetrics(metricsEndpoint);
      }, 30000); // Send every 30 seconds

      return () => {
        clearInterval(interval);
        webVitalsMonitor.cleanup();
      };
    }

    return () => {
      webVitalsMonitor.cleanup();
    };
  }, [metricsEndpoint]);
}
