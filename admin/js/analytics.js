(function exposeAdminAnalytics(global) {
  "use strict";

  const ANALYTICS_PATH = "/admin/analytics";

  const PERIODS = Object.freeze([
    ["today", "Today"],
    ["last7Days", "Last 7 Days"],
    ["last30Days", "Last 30 Days"],
  ]);

  const HISTORICAL_METRICS = Object.freeze([
    ["totalUsers", "Total users", "count"],
    ["newUsers", "New users", "count"],
    ["sessions", "Sessions", "count"],
    ["views", "Views", "count"],
    ["averageEngagementTimeSeconds", "Avg. engagement / active user", "duration"],
    ["eventCount", "Events", "count"],
  ]);

  const numberFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  });

  const percentageFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  });

  const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  function createController({ client, workerBaseUrl } = {}) {
    const elements = {
      view: document.querySelector("#analytics-view"),
      state: document.querySelector("#analytics-state"),
      content: document.querySelector("#analytics-content"),
      refresh: document.querySelector("#analytics-refresh"),
      updated: document.querySelector("#analytics-updated"),
      liveMetrics: document.querySelector("#analytics-live-metrics"),
      periods: document.querySelector("#analytics-periods"),
      topContent: document.querySelector("#analytics-top-content"),
      trafficSources: document.querySelector("#analytics-traffic-sources"),
    };

    const isAvailable = Object.values(elements).every(Boolean);
    let requestState = "idle";
    let analyticsData = null;
    let requestGeneration = 0;
    let activeRequest = null;

    if (!isAvailable) {
      return Object.freeze({
        ensureLoaded() {},
        refresh() {},
        getData: () => null,
      });
    }

    function setBusy(isBusy) {
      elements.view.setAttribute("aria-busy", String(isBusy));
      elements.refresh.disabled = isBusy;
      elements.refresh.textContent = isBusy ? "Refreshing…" : "Refresh";
    }

    function showState(message, kind = "") {
      elements.state.textContent = message;
      elements.state.className = `panel analytics-state${kind ? ` is-${kind}` : ""}`;
      elements.state.hidden = false;
      elements.content.hidden = true;
    }

    function showData(data) {
      renderAnalytics(data, elements);
      elements.state.hidden = true;
      elements.content.hidden = false;
    }

    async function loadAnalytics() {
      if (!workerBaseUrl) {
        requestState = "unconfigured";
        showState(
          "Analytics is not configured. Add the deployed Worker URL in js/config.js, then refresh.",
          "warning",
        );
        return;
      }

      if (!client) {
        requestState = "error";
        showState("Analytics temporarily unavailable.", "error");
        return;
      }

      const generation = ++requestGeneration;
      activeRequest?.abort();
      activeRequest = new AbortController();
      requestState = "loading";
      setBusy(true);
      showState("Loading analytics…", "loading");

      try {
        const accessToken = await getAccessToken(client);
        if (generation !== requestGeneration) return;

        const response = await global.fetch(`${workerBaseUrl}${ANALYTICS_PATH}`, {
          method: "GET",
          cache: "no-store",
          signal: activeRequest.signal,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const responseBody = await parseResponseBody(response);
        if (generation !== requestGeneration) return;

        if (!response.ok) {
          throw createAnalyticsError(response, responseBody);
        }

        analyticsData = normalizeAnalytics(responseBody);
        requestState = "ready";
        showData(analyticsData);
      } catch (error) {
        if (generation !== requestGeneration || error?.name === "AbortError") return;

        requestState = "error";
        const failure = errorPresentation(error);
        showState(failure.message, failure.kind);
      } finally {
        if (generation === requestGeneration) {
          activeRequest = null;
          setBusy(false);
        }
      }
    }

    elements.refresh.addEventListener("click", loadAnalytics);

    return Object.freeze({
      ensureLoaded() {
        if (requestState === "idle") {
          return loadAnalytics();
        }

        return Promise.resolve();
      },
      refresh: loadAnalytics,
      getData: () => analyticsData,
    });
  }

  async function getAccessToken(client) {
    const { data, error } = await client.auth.getSession();

    if (error || !data.session?.access_token) {
      const authError = new Error("Administrator session unavailable.");
      authError.code = "session_unavailable";
      authError.status = 401;
      throw authError;
    }

    return data.session.access_token;
  }

  async function parseResponseBody(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function createAnalyticsError(response, responseBody) {
    const error = new Error(
      responseBody?.error?.message || `Analytics request failed (${response.status}).`,
    );

    error.status = response.status;
    error.code = String(responseBody?.error?.code || "analytics_request_failed");
    return error;
  }

  function errorPresentation(error) {
    const status = Number(error?.status);
    const code = String(error?.code || "").toLowerCase();

    if (status === 401 || status === 403 || code === "session_unavailable") {
      return {
        kind: "error",
        message: "Your administrator access could not be verified. Sign in again, then refresh.",
      };
    }

    if (
      code.includes("config") ||
      code.includes("credential") ||
      code.includes("property") ||
      code.includes("google_auth")
    ) {
      return {
        kind: "warning",
        message: "Google Analytics is not configured yet. Complete the Worker analytics setup, then refresh.",
      };
    }

    return {
      kind: "error",
      message: "Analytics temporarily unavailable. The rest of Admin is still available; try Refresh again shortly.",
    };
  }

  function normalizeAnalytics(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("The analytics response was empty.");
    }

    const requiredObjects = [
      payload.realtime,
      payload.today,
      payload.last7Days,
      payload.last30Days,
    ];

    if (
      requiredObjects.some((value) => !value || typeof value !== "object") ||
      !Array.isArray(payload.topContent) ||
      !Array.isArray(payload.trafficSources)
    ) {
      throw new Error("The analytics response did not match the expected schema.");
    }

    const normalized = {
      generatedAt: normalizeDate(payload.generatedAt),
      realtime: normalizeMetricSet(payload.realtime, [
        "activeUsers",
        "views",
        "eventCount",
      ]),
      today: normalizeHistoricalMetrics(payload.today),
      last7Days: normalizeHistoricalMetrics(payload.last7Days),
      last30Days: normalizeHistoricalMetrics(payload.last30Days),
      topContent: payload.topContent.map(normalizeContentRow).filter(Boolean),
      trafficSources: payload.trafficSources.map(normalizeTrafficRow).filter(Boolean),
    };

    const hasReturnedMetric = [
      ...Object.values(normalized.realtime),
      ...Object.values(normalized.today),
      ...Object.values(normalized.last7Days),
      ...Object.values(normalized.last30Days),
    ].some((value) => value !== null);

    if (!hasReturnedMetric) {
      throw new Error("The analytics response contained no metrics.");
    }

    return deepFreeze(normalized);
  }

  function normalizeHistoricalMetrics(metrics) {
    return normalizeMetricSet(
      metrics,
      HISTORICAL_METRICS.map(([key]) => key),
    );
  }

  function normalizeMetricSet(source, keys) {
    return keys.reduce((metrics, key) => {
      metrics[key] = finiteNumberOrNull(source[key]);
      return metrics;
    }, {});
  }

  function normalizeContentRow(row) {
    if (!row || typeof row !== "object") return null;

    const views = finiteNumberOrNull(row.views);
    if (views === null) return null;

    const title = textOrEmpty(row.title);
    const path = textOrEmpty(row.path);

    return {
      title: title || path || "Untitled page",
      path,
      views,
    };
  }

  function normalizeTrafficRow(row) {
    if (!row || typeof row !== "object") return null;

    const source = textOrEmpty(row.source);
    const medium = textOrEmpty(row.medium);
    const sessions = finiteNumberOrNull(row.sessions);
    const users = finiteNumberOrNull(row.users);
    const percentage = finiteNumberOrNull(row.percentage);

    if (sessions === null && users === null && percentage === null) return null;

    return {
      source: source || "Source not provided",
      medium,
      sessions,
      users,
      percentage,
    };
  }

  function normalizeDate(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function finiteNumberOrNull(value) {
    if (value === null || value === "" || typeof value === "boolean") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function textOrEmpty(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function renderAnalytics(data, elements) {
    renderLiveMetrics(data.realtime, elements.liveMetrics);
    renderPeriods(data, elements.periods);
    renderTopContent(data.topContent, elements.topContent);
    renderTrafficSources(data.trafficSources, elements.trafficSources);

    elements.updated.textContent = data.generatedAt
      ? `Updated ${dateTimeFormatter.format(new Date(data.generatedAt))}`
      : "Latest available report";
    elements.updated.title = data.generatedAt || "";
  }

  function renderLiveMetrics(realtime, container) {
    const metrics = [
      ["Active users", realtime.activeUsers],
      ["Views", realtime.views],
      ["Events", realtime.eventCount],
    ];

    container.replaceChildren(
      ...metrics.map(([label, value], index) =>
        createMetric(label, formatCount(value), index === 0 ? "is-primary" : ""),
      ),
    );
  }

  function renderPeriods(data, container) {
    container.replaceChildren(
      ...PERIODS.map(([periodKey, periodLabel]) => {
        const card = createElement("article", "panel analytics-period-card");
        const heading = createElement("h3", "", periodLabel);
        const metrics = createElement("dl", "analytics-period-metrics");

        HISTORICAL_METRICS.forEach(([metricKey, metricLabel, format]) => {
          const item = createElement("div", "analytics-period-metric");
          const term = createElement("dt", "", metricLabel);
          const value = createElement(
            "dd",
            "",
            format === "duration"
              ? formatDuration(data[periodKey][metricKey])
              : formatCount(data[periodKey][metricKey]),
          );

          item.append(term, value);
          metrics.append(item);
        });

        card.append(heading, metrics);
        return card;
      }),
    );
  }

  function renderTopContent(rows, container) {
    if (!rows.length) {
      renderEmptyList(container, "No content activity was returned for this period.");
      return;
    }

    container.replaceChildren(
      ...rows.map((row) => {
        const item = createElement("li", "analytics-list-row");
        const identity = createElement("div", "analytics-list-identity");
        const title = createElement("strong", "", row.title);
        const path = createElement("span", "", row.path);
        const value = createElement("div", "analytics-list-value");

        identity.append(title);
        if (row.path && row.path !== row.title) identity.append(path);
        value.append(
          createElement("strong", "", formatCount(row.views)),
          createElement("span", "", "views"),
        );
        item.append(identity, value);
        return item;
      }),
    );
  }

  function renderTrafficSources(rows, container) {
    if (!rows.length) {
      renderEmptyList(container, "No acquisition activity was returned for this period.");
      return;
    }

    container.replaceChildren(
      ...rows.map((row) => {
        const item = createElement("li", "analytics-list-row");
        const identity = createElement("div", "analytics-list-identity");
        const value = createElement("div", "analytics-list-value");
        const detailParts = [];

        if (row.percentage !== null) detailParts.push("session share");
        if (row.sessions !== null) detailParts.push(`${formatCount(row.sessions)} sessions`);
        if (row.users !== null) detailParts.push(`${formatCount(row.users)} users`);

        identity.append(
          createElement("strong", "", row.source),
          ...(row.medium ? [createElement("span", "", row.medium)] : []),
        );
        value.append(
          createElement("strong", "", formatPercentage(row.percentage)),
          createElement("span", "", detailParts.join(" · ") || "Metrics not returned"),
        );
        item.append(identity, value);
        return item;
      }),
    );
  }

  function renderEmptyList(container, message) {
    container.replaceChildren(createElement("li", "analytics-empty", message));
  }

  function createMetric(label, value, modifier = "") {
    const metric = createElement(
      "article",
      `analytics-live-metric${modifier ? ` ${modifier}` : ""}`,
    );

    metric.append(
      createElement("p", "analytics-metric-value", value),
      createElement("p", "analytics-metric-label", label),
    );
    return metric;
  }

  function createElement(tagName, className = "", text = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== "") element.textContent = text;
    return element;
  }

  function formatCount(value) {
    return value === null ? "—" : numberFormatter.format(value);
  }

  function formatPercentage(value) {
    return value === null ? "—" : `${percentageFormatter.format(value)}%`;
  }

  function formatDuration(value) {
    if (value === null) return "—";

    const totalSeconds = Math.max(0, Math.round(value));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  global.PaceAdminAnalytics = Object.freeze({
    createController,
    normalizeAnalytics,
  });
})(window);
