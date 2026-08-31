(function exposeAdminApi(global) {
  "use strict";

  const API_ROOT = "/api/admin";

  async function request(path, options = {}) {
    if (global.location.protocol === "file:") {
      throw new Error("The admin API is unavailable when this page is opened as a local file.");
    }

    const response = await global.fetch(`${API_ROOT}${path}`, {
      ...options,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = new Error(`Admin API request failed with status ${response.status}.`);
      error.status = response.status;
      throw error;
    }

    return response.status === 204 ? null : response.json();
  }

  global.PaceAdminApi = Object.freeze({
    getSession: () => request("/session"),
    listFilms: () => request("/films"),
    createDraft: (draft) => request("/films", { method: "POST", body: JSON.stringify(draft) }),
    requestUpload: (fileMetadata) =>
      request("/uploads", { method: "POST", body: JSON.stringify(fileMetadata) }),
    requestAutomation: (filmId, tasks) =>
      request(`/films/${encodeURIComponent(filmId)}/automations`, {
        method: "POST",
        body: JSON.stringify({ tasks }),
      }),
    publishFilm: (filmId, version) =>
      request(`/films/${encodeURIComponent(filmId)}/publish`, {
        method: "POST",
        body: JSON.stringify({ version }),
      }),
  });
})(window);
