(function configurePaceBros(global) {
  "use strict";

  global.PaceBrosConfig = Object.freeze({
    // Public GA4 web-stream Measurement ID (for example, G-...). Never place Google API secrets here.
    ga4MeasurementId: "G-P5S1BYYPNP",
    // Deployed Worker URL (no trailing slash).
    workerBaseUrl: "https://pace-bros-media.pace-bros-visuals.workers.dev",
  });
})(window);
