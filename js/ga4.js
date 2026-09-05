(function initializeGoogleAnalytics(global, document) {
  "use strict";

  const measurementId = global.PaceBrosConfig?.ga4MeasurementId?.trim().toUpperCase();
  if (!measurementId) return;

  if (!/^G-[A-Z0-9]{6,}$/.test(measurementId)) {
    console.warn("Google Analytics was not started because the GA4 Measurement ID is invalid.");
    return;
  }

  global.dataLayer = global.dataLayer || [];
  global.gtag =
    global.gtag ||
    function gtag() {
      global.dataLayer.push(arguments);
    };

  global.gtag("js", new Date());
  global.gtag("config", measurementId);

  const analyticsScript = document.createElement("script");
  analyticsScript.async = true;
  analyticsScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(analyticsScript);
})(window, document);
