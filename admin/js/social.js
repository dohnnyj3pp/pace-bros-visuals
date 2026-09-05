(function exposeAdminSocial(global) {
  "use strict";

  const SOCIAL_CONNECTIONS_PATH = "/admin/social/connections";
  const META_CONNECT_PATH = "/admin/social/meta/connect";
  const META_COMPLETE_PATH = "/admin/social/meta/complete";
  const META_SELECT_PATH = "/admin/social/meta/select";

  let oauthCallback = captureOAuthCallback();
  let callbackClaimed = false;

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  function createController({ client, workerBaseUrl } = {}) {
    const elements = {
      view: document.querySelector("#social-media-view"),
      refresh: document.querySelector("#social-refresh"),
      feedback: document.querySelector("#social-feedback"),
      loading: document.querySelector("#social-loading"),
      providerStatus: document.querySelector("#meta-provider-status"),
      connectState: document.querySelector("#meta-connect-state"),
      connectedState: document.querySelector("#meta-connected-state"),
      connect: document.querySelector("#connect-meta-button"),
      reconnect: document.querySelector("#reconnect-meta-button"),
      disconnect: document.querySelector("#disconnect-meta-button"),
      facebookStatus: document.querySelector("#meta-facebook-status"),
      facebookName: document.querySelector("#meta-facebook-name"),
      facebookDetail: document.querySelector("#meta-facebook-detail"),
      instagramStatus: document.querySelector("#meta-instagram-status"),
      instagramName: document.querySelector("#meta-instagram-name"),
      instagramDetail: document.querySelector("#meta-instagram-detail"),
      permissions: document.querySelector("#meta-permissions"),
      connectedAt: document.querySelector("#meta-connected-at"),
      tokenStatus: document.querySelector("#meta-token-status"),
      selection: document.querySelector("#meta-page-selection"),
      selectionOptions: document.querySelector("#meta-page-options"),
      cancelSelection: document.querySelector("#cancel-meta-selection"),
    };

    const isAvailable = Object.values(elements).every(Boolean);
    const state = {
      loadState: "idle",
      busy: false,
      connections: [],
      metaConnection: null,
      selectionToken: "",
      selectionPages: [],
    };

    if (!isAvailable) {
      return Object.freeze({
        ensureLoaded() {},
        refresh() {},
        hasPendingCallback: () => Boolean(oauthCallback),
      });
    }

    function setBusy(isBusy, message = "") {
      state.busy = isBusy;
      elements.view.setAttribute("aria-busy", String(isBusy));

      elements.view
        .querySelectorAll("button")
        .forEach((button) => {
          button.disabled = isBusy;
        });

      elements.loading.textContent = message || "Loading connected accounts…";
      elements.loading.hidden = !isBusy;
    }

    function setFeedback(message = "", kind = "") {
      elements.feedback.textContent = message;
      elements.feedback.className = `feedback${kind ? ` is-${kind}` : ""}`;
    }

    function setBadge(element, label, modifier) {
      element.textContent = label;
      element.className = `status-badge ${modifier}`;
    }

    async function initializeWorkspace() {
      if (!workerBaseUrl) {
        state.loadState = "unconfigured";
        renderConnection();
        setFeedback(
          "Social connections are not configured. Add the deployed Worker URL in js/config.js, then refresh.",
          "warning",
        );
        return;
      }

      if (!client) {
        state.loadState = "error";
        renderConnection();
        setFeedback("Social connections are temporarily unavailable.", "error");
        return;
      }

      state.loadState = "loading";
      setBusy(true, oauthCallback ? "Completing Meta authorization…" : "Loading connected accounts…");

      let callbackMessage = null;

      try {
        const callback = claimOAuthCallback();

        if (callback) {
          callbackMessage = await completeOAuthCallback(callback);
        }

        await fetchConnections();
        state.loadState = "ready";
        renderConnection();

        if (state.selectionToken) {
          renderPageSelection();
        }

        if (callbackMessage) {
          setFeedback(callbackMessage.message, callbackMessage.kind);
        }
      } catch (error) {
        state.loadState = "error";
        renderConnection();
        const presentation = errorPresentation(error);
        setFeedback(presentation.message, presentation.kind);
      } finally {
        setBusy(false);
      }
    }

    async function refreshConnections() {
      if (state.busy) return;

      if (!workerBaseUrl || !client) {
        state.loadState = "idle";
        return initializeWorkspace();
      }

      setFeedback();
      setBusy(true, "Refreshing connected accounts…");

      try {
        await fetchConnections();
        state.loadState = "ready";
        renderConnection();
      } catch (error) {
        const presentation = errorPresentation(error);
        setFeedback(presentation.message, presentation.kind);
      } finally {
        setBusy(false);
      }
    }

    async function fetchConnections() {
      const payload = await requestJSON(SOCIAL_CONNECTIONS_PATH, {
        method: "GET",
      });

      const rows = Array.isArray(payload)
        ? payload
        : payload && Array.isArray(payload.connections)
          ? payload.connections
          : null;

      if (!rows) {
        const responseError = new Error("The social connections response was invalid.");
        responseError.code = "invalid_social_response";
        throw responseError;
      }

      state.connections = rows.map(normalizeConnection).filter(Boolean);
      state.metaConnection = findMetaConnection(state.connections);
    }

    async function completeOAuthCallback(callback) {
      if (callback.error) {
        const wasCancelled = callback.error === "access_denied";
        return {
          kind: wasCancelled ? "warning" : "error",
          message: wasCancelled
            ? "Meta authorization was cancelled. No connection was changed."
            : "Meta authorization did not complete. Start the connection again.",
        };
      }

      if (!callback.code || !callback.state) {
        const callbackError = new Error("The Meta callback was incomplete.");
        callbackError.code = "invalid_oauth_callback";
        throw callbackError;
      }

      const result = await requestJSON(META_COMPLETE_PATH, {
        method: "POST",
        body: {
          code: callback.code,
          state: callback.state,
        },
      });

      if (result?.selectionRequired) {
        const selectionToken = textOrEmpty(result.selectionToken);
        const pages = Array.isArray(result.pages)
          ? result.pages.map(normalizePage).filter(Boolean)
          : [];

        if (!selectionToken || !pages.length) {
          const responseError = new Error("Meta Page selection could not be prepared.");
          responseError.code = "invalid_selection_response";
          throw responseError;
        }

        state.selectionToken = selectionToken;
        state.selectionPages = pages;

        return {
          kind: "success",
          message: "Meta authorization succeeded. Select the Facebook Page Pace Bros should connect.",
        };
      }

      if (result?.connection) {
        const connection = normalizeConnection(result.connection);
        if (!connection) {
          const responseError = new Error("The Meta connection response was invalid.");
          responseError.code = "invalid_social_response";
          throw responseError;
        }

        state.connections = [connection];
        state.metaConnection = connection;
      } else {
        const responseError = new Error("The Meta connection response was empty.");
        responseError.code = "invalid_social_response";
        throw responseError;
      }

      return {
        kind: "success",
        message: "Meta connected successfully.",
      };
    }

    async function startMetaConnection(replaceExisting = false) {
      if (state.busy) return;

      setFeedback();
      setBusy(true, "Preparing secure Meta authorization…");

      try {
        const result = await requestJSON(META_CONNECT_PATH, {
          method: "POST",
          body: replaceExisting && state.metaConnection?.id
            ? { connectionId: state.metaConnection.id }
            : {},
        });

        const authorizationUrl = validateAuthorizationUrl(result?.authorizationUrl);
        global.location.assign(authorizationUrl);
      } catch (error) {
        const presentation = errorPresentation(error);
        setFeedback(presentation.message, presentation.kind);
        setBusy(false);
      }
    }

    async function selectMetaPage(pageId) {
      if (state.busy || !state.selectionToken) return;

      const page = state.selectionPages.find((candidate) => candidate.id === pageId);
      if (!page) return;

      setFeedback();
      setBusy(true, `Connecting ${page.name}…`);

      try {
        const result = await requestJSON(META_SELECT_PATH, {
          method: "POST",
          body: {
            selectionToken: state.selectionToken,
            pageId: page.id,
          },
        });

        const connection = normalizeConnection(result?.connection);
        if (!connection) {
          const responseError = new Error("The Meta Page connection response was invalid.");
          responseError.code = "invalid_social_response";
          throw responseError;
        }

        state.selectionToken = "";
        state.selectionPages = [];
        elements.selection.hidden = true;
        state.connections = [connection];
        state.metaConnection = connection;

        await fetchConnections();
        state.loadState = "ready";
        renderConnection();
        setFeedback(`${page.name} is connected through Meta.`, "success");
      } catch (error) {
        const presentation = errorPresentation(error);
        setFeedback(presentation.message, presentation.kind);
        renderPageSelection();
      } finally {
        setBusy(false);
      }
    }

    async function disconnectMeta() {
      if (state.busy || !state.metaConnection?.id) return;

      const confirmed = global.confirm(
        "Disconnect Meta from Pace Bros Admin? Stored Meta credentials will be removed and no account will remain available for future publishing.",
      );

      if (!confirmed) return;

      setFeedback();
      setBusy(true, "Disconnecting Meta…");

      try {
        await requestJSON(
          `${SOCIAL_CONNECTIONS_PATH}/${encodeURIComponent(state.metaConnection.id)}`,
          { method: "DELETE" },
        );

        state.connections = state.connections.filter(
          (connection) => connection.id !== state.metaConnection.id,
        );
        state.metaConnection = findMetaConnection(state.connections);
        renderConnection();
        setFeedback("Meta has been disconnected and its stored credentials removed.", "success");
      } catch (error) {
        const presentation = errorPresentation(error);
        setFeedback(presentation.message, presentation.kind);
      } finally {
        setBusy(false);
      }
    }

    function cancelPageSelection() {
      if (state.busy) return;
      state.selectionToken = "";
      state.selectionPages = [];
      elements.selectionOptions.replaceChildren();
      elements.selection.hidden = true;
      setFeedback("Page selection cancelled. No new Meta connection was saved.", "warning");
    }

    function renderConnection() {
      const connection = state.metaConnection;
      elements.loading.hidden = true;
      elements.connectState.hidden = Boolean(connection);
      elements.connectedState.hidden = !connection;

      if (!connection) {
        setBadge(elements.providerStatus, "Not connected", "is-archived");
        return;
      }

      const requiresReconnect = connection.status === "reconnect_required";
      const statusLabel = requiresReconnect ? "Reconnect required" : "Connected";
      const statusClass = requiresReconnect ? "is-warning" : "is-active";
      const facebook = connection.facebook;
      const instagram = connection.instagram;
      const instagramUnavailable = connection.instagramDiscovery === "unavailable";

      setBadge(elements.providerStatus, statusLabel, statusClass);
      setBadge(elements.facebookStatus, statusLabel, statusClass);
      elements.facebookName.textContent = facebook?.name || connection.displayName || "Facebook Page";
      elements.facebookDetail.textContent = facebook?.id
        ? `Page ID ${facebook.id}`
        : "Connected Facebook Page";

      if (instagram && !instagramUnavailable) {
        setBadge(elements.instagramStatus, statusLabel, statusClass);
        elements.instagramName.textContent = instagram.username
          ? `@${instagram.username.replace(/^@/, "")}`
          : instagram.name || "Instagram Professional account";
        elements.instagramDetail.textContent = instagram.name && instagram.username
          ? instagram.name
          : "Linked Instagram Professional account";
      } else if (instagramUnavailable) {
        setBadge(elements.instagramStatus, "Details unavailable", "is-warning");
        elements.instagramName.textContent = "Linked account detected";
        elements.instagramDetail.textContent =
          "Meta did not return the Instagram profile details. Refresh or reconnect to try discovery again.";
      } else {
        setBadge(elements.instagramStatus, "Not connected", "is-archived");
        elements.instagramName.textContent = "No professional account linked";
        elements.instagramDetail.textContent =
          "Link an Instagram Professional account to this Facebook Page, then reconnect Meta to discover it.";
      }

      elements.permissions.textContent = connection.scopes.length
        ? connection.scopes.join(", ")
        : "Not reported";
      elements.connectedAt.textContent = formatDate(connection.createdAt);
      elements.tokenStatus.textContent = requiresReconnect
        ? "Reconnect required"
        : connection.tokenExpiresAt
          ? `Expires ${formatDate(connection.tokenExpiresAt)}`
          : "Connected; no expiration reported";
    }

    function renderPageSelection() {
      if (!state.selectionToken || !state.selectionPages.length) {
        elements.selectionOptions.replaceChildren();
        elements.selection.hidden = true;
        return;
      }

      const options = state.selectionPages.map((page) => {
        const option = createElement("article", "meta-page-option");
        const identity = createElement("div", "meta-page-identity");
        const name = createElement("h3", "", page.name);
        const detail = createElement(
          "p",
          "",
          page.instagram?.username
            ? `Linked Instagram: @${page.instagram.username.replace(/^@/, "")}`
            : page.instagram?.id
              ? "Linked Instagram Professional account detected"
            : "No linked Instagram Professional account found",
        );
        const button = createElement("button", "button button-publish", "Connect");

        button.type = "button";
        button.dataset.pageId = page.id;
        identity.append(name, detail);
        option.append(identity, button);
        return option;
      });

      elements.selectionOptions.replaceChildren(...options);
      elements.selection.hidden = false;
      elements.selection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    async function requestJSON(path, { method = "GET", body } = {}) {
      if (!workerBaseUrl) {
        const configError = new Error("Worker URL not configured.");
        configError.code = "social_not_configured";
        throw configError;
      }

      const accessToken = await getAccessToken(client);
      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      };

      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const response = await global.fetch(`${workerBaseUrl}${path}`, {
        method,
        cache: "no-store",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const responseBody = await parseResponseBody(response);

      if (!response.ok) {
        throw createRequestError(response, responseBody);
      }

      return responseBody || {};
    }

    elements.refresh.addEventListener("click", refreshConnections);
    elements.connect.addEventListener("click", () => startMetaConnection(false));
    elements.reconnect.addEventListener("click", () => startMetaConnection(true));
    elements.disconnect.addEventListener("click", disconnectMeta);
    elements.cancelSelection.addEventListener("click", cancelPageSelection);
    elements.selectionOptions.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-page-id]");
      if (button) selectMetaPage(button.dataset.pageId);
    });

    return Object.freeze({
      ensureLoaded() {
        if (state.loadState === "idle") {
          return initializeWorkspace();
        }

        return Promise.resolve();
      },
      refresh: refreshConnections,
      hasPendingCallback: () => Boolean(oauthCallback && !callbackClaimed),
    });
  }

  function captureOAuthCallback() {
    try {
      const url = new URL(global.location.href);
      const hasCallback = url.searchParams.has("code") || url.searchParams.has("error");
      if (!hasCallback) return null;

      const callback = Object.freeze({
        code: textOrEmpty(url.searchParams.get("code")),
        state: textOrEmpty(url.searchParams.get("state")),
        error: textOrEmpty(url.searchParams.get("error")),
      });

      [
        "code",
        "state",
        "error",
        "error_code",
        "error_reason",
        "error_description",
      ].forEach((key) => url.searchParams.delete(key));

      const cleanLocation = `${url.pathname}${url.search}${url.hash}`;
      global.history.replaceState(global.history.state, "", cleanLocation);
      return callback;
    } catch {
      return null;
    }
  }

  function claimOAuthCallback() {
    if (!oauthCallback || callbackClaimed) return null;
    callbackClaimed = true;
    const callback = oauthCallback;
    oauthCallback = null;
    return callback;
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

  function createRequestError(response, responseBody) {
    const error = new Error(
      responseBody?.error?.message || `Social connection request failed (${response.status}).`,
    );
    error.status = response.status;
    error.code = textOrEmpty(responseBody?.error?.code) || "social_request_failed";
    return error;
  }

  function errorPresentation(error) {
    const status = Number(error?.status);
    const code = textOrEmpty(error?.code).toLowerCase();

    if (status === 401 || status === 403 || code === "session_unavailable") {
      return {
        kind: "error",
        message: "Your administrator access could not be verified. Sign in again, then retry.",
      };
    }

    if (code.includes("config") || code.includes("not_configured")) {
      return {
        kind: "warning",
        message: "Meta is not configured yet. Complete the Worker and Meta application setup, then retry.",
      };
    }

    if (code.includes("storage")) {
      return {
        kind: "error",
        message: "Social connection storage is unavailable. Confirm the Social Connections migration has been applied, then retry.",
      };
    }

    if (code.includes("state") || code === "invalid_oauth_callback") {
      return {
        kind: "warning",
        message: "This Meta authorization attempt is invalid or expired. Start Connect Meta again.",
      };
    }

    if (code.includes("permission") || code.includes("scope")) {
      return {
        kind: "warning",
        message: "Meta did not grant the required Page permissions. Reconnect and approve the requested access.",
      };
    }

    if (code.includes("no_pages") || code.includes("managed_page")) {
      return {
        kind: "warning",
        message: "No manageable Facebook Pages were returned. Confirm this Meta identity has access to the Pace Bros Visuals Page.",
      };
    }

    if (code.includes("selection")) {
      return {
        kind: "warning",
        message: "That Facebook Page selection expired or is no longer available. Start Connect Meta again.",
      };
    }

    return {
      kind: "error",
      message: "Meta is temporarily unavailable. The rest of Admin is still available; try again shortly.",
    };
  }

  function validateAuthorizationUrl(value) {
    const raw = textOrEmpty(value);

    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      const isFacebookHost = host === "facebook.com" || host.endsWith(".facebook.com");

      if (url.protocol !== "https:" || !isFacebookHost) throw new Error();
      return url.href;
    } catch {
      const error = new Error("The Meta authorization URL was invalid.");
      error.code = "invalid_authorization_url";
      throw error;
    }
  }

  function normalizeConnection(raw) {
    if (!raw || typeof raw !== "object") return null;

    const id = textOrEmpty(raw.id);
    const provider = textOrEmpty(raw.provider).toLowerCase();
    if (!id || (provider && provider !== "meta")) return null;

    const facebookSource = raw.facebook && typeof raw.facebook === "object"
      ? raw.facebook
      : raw.platform === "instagram"
        ? null
        : raw;
    const instagramSource = raw.instagram || raw.linkedInstagram || raw.linked_instagram ||
      (raw.platform === "instagram" ? raw : null);
    const facebook = normalizeFacebookAccount(facebookSource, raw);
    const instagram = normalizeInstagramAccount(instagramSource);

    const tokenExpiresAt = normalizeDate(raw.tokenExpiresAt || raw.token_expires_at);
    const reportedStatus = normalizeStatus(raw.status);
    const tokenExpired = tokenExpiresAt && new Date(tokenExpiresAt).getTime() <= Date.now();

    return {
      id,
      provider: provider || "meta",
      platform: textOrEmpty(raw.platform).toLowerCase() || "meta",
      status: tokenExpired ? "reconnect_required" : reportedStatus,
      displayName: textOrEmpty(raw.displayName || raw.display_name),
      externalAccountId: textOrEmpty(raw.externalAccountId || raw.external_account_id),
      tokenExpiresAt,
      createdAt: normalizeDate(
        raw.connectedAt || raw.connected_at || raw.createdAt || raw.created_at,
      ),
      updatedAt: normalizeDate(raw.updatedAt || raw.updated_at),
      scopes: normalizeScopes(raw.scopes),
      facebook,
      instagram,
      instagramDiscovery: normalizeInstagramDiscovery(
        raw.instagramDiscovery || raw.instagram_discovery,
        instagram,
      ),
    };
  }

  function normalizeFacebookAccount(source, fallback) {
    if (!source || typeof source !== "object") return null;
    const id = textOrEmpty(
      source.id || source.externalAccountId || source.external_account_id ||
      fallback?.externalAccountId || fallback?.external_account_id,
    );
    const name = textOrEmpty(
      source.name || source.displayName || source.display_name ||
      fallback?.displayName || fallback?.display_name,
    );

    return id || name ? { id, name } : null;
  }

  function normalizeInstagramAccount(source) {
    if (!source || typeof source !== "object") return null;
    const id = textOrEmpty(source.id || source.externalAccountId || source.external_account_id);
    const username = textOrEmpty(source.username);
    const name = textOrEmpty(source.name || source.displayName || source.display_name);
    return id || username || name ? { id, username, name } : null;
  }

  function normalizePage(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = textOrEmpty(raw.id || raw.externalAccountId || raw.external_account_id);
    const name = textOrEmpty(raw.name || raw.displayName || raw.display_name);
    if (!id || !name) return null;

    return {
      id,
      name,
      instagram: normalizeInstagramAccount(
        raw.instagram || raw.linkedInstagram || raw.linked_instagram,
      ),
    };
  }

  function findMetaConnection(connections) {
    const metaConnections = connections.filter((connection) => connection.provider === "meta");
    if (!metaConnections.length) return null;

    const primary = metaConnections.find(
      (connection) => connection.platform === "meta" || connection.platform === "facebook",
    ) || metaConnections[0];
    const instagramRow = metaConnections.find(
      (connection) => connection.platform === "instagram",
    );

    if (!primary.instagram && instagramRow?.instagram) {
      return Object.freeze({ ...primary, instagram: instagramRow.instagram });
    }

    return primary;
  }

  function normalizeScopes(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(textOrEmpty).filter(Boolean))];
  }

  function normalizeStatus(value) {
    return textOrEmpty(value).toLowerCase() === "reconnect_required"
      ? "reconnect_required"
      : "connected";
  }

  function normalizeInstagramDiscovery(value, instagram) {
    const status = textOrEmpty(value).toLowerCase();
    if (["connected", "not_linked", "unavailable"].includes(status)) return status;
    return instagram ? "connected" : "not_linked";
  }

  function normalizeDate(value) {
    const text = textOrEmpty(value);
    if (!text) return "";
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function formatDate(value) {
    if (!value) return "Not reported";
    return dateFormatter.format(new Date(value));
  }

  function textOrEmpty(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function createElement(tagName, className = "", text = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== "") element.textContent = text;
    return element;
  }

  global.PaceAdminSocial = Object.freeze({
    createController,
    hasPendingCallback: () => Boolean(oauthCallback && !callbackClaimed),
  });
})(window);
