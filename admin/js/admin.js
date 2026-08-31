(function exposeAdminWorkspace(global) {
  "use strict";

  let initialized = false;

  function initialize({ user, adminProfile } = {}) {
    if (initialized) return;
    initialized = true;

  const form = document.querySelector("#film-form");
  const titleInput = document.querySelector("#title");
  const slugInput = document.querySelector("#slug");
  const loglineInput = document.querySelector("#logline");
  const loglineCount = document.querySelector("#logline-count");
  const posterInput = document.querySelector("#poster-file");
  const previewInput = document.querySelector("#preview-file");
  const posterSummary = document.querySelector("#poster-summary");
  const previewSummary = document.querySelector("#preview-summary");
  const connectionStatus = document.querySelector("#connection-status");
  const connectionLabel = document.querySelector("#connection-label");
  const accessCopy = document.querySelector("#access-copy");
  const reviewStatus = document.querySelector("#review-status");

  const reviewFields = {
    title: document.querySelector("#review-title"),
    slug: document.querySelector("#review-slug"),
    release: document.querySelector("#review-release"),
    assets: document.querySelector("#review-assets"),
    automation: document.querySelector("#review-automation"),
  };

  let slugWasEdited = false;

  function slugify(value) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1) return "0 bytes";
    const units = ["bytes", "KB", "MB", "GB"];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** unitIndex;
    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  function summarizeFile(input, output, fallback) {
    const [file] = input.files;
    output.textContent = file ? `${file.name} · ${formatBytes(file.size)}` : fallback;
  }

  function setConnectionState(state, label, detail) {
    connectionStatus.classList.remove("is-checking", "is-connected", "is-locked");
    connectionStatus.classList.add(state);
    connectionLabel.textContent = label;
    accessCopy.textContent = detail;
  }

  const displayName = adminProfile?.display_name || "Authorized administrator";
  setConnectionState(
    "is-connected",
    displayName,
    `Supabase verified the administrator session for ${user?.email || "this account"}. Phase 2 controls remain disabled.`,
  );

  function reviewDraft(event) {
    event.preventDefault();
    form.classList.add("was-validated");

    if (!form.reportValidity()) {
      reviewStatus.classList.remove("is-ready");
      reviewStatus.textContent = "Complete the required fields in the expected format before reviewing this draft.";
      return;
    }

    const data = new FormData(form);
    const automationTasks = data.getAll("automation");
    const selectedAssets = [posterInput.files[0]?.name, previewInput.files[0]?.name].filter(Boolean);

    reviewFields.title.textContent = String(data.get("title"));
    reviewFields.slug.textContent = String(data.get("slug"));
    reviewFields.release.textContent = `${data.get("year")} · ${data.get("runtime")} · ${data.get("format")}`;
    reviewFields.assets.textContent = selectedAssets.length ? selectedAssets.join(" + ") : "No files selected";
    reviewFields.automation.textContent = automationTasks.length
      ? automationTasks.join(", ")
      : "None selected";
    reviewStatus.classList.add("is-ready");
    reviewStatus.textContent = "Draft looks complete locally. It has not been saved or uploaded.";
  }

  titleInput.addEventListener("input", () => {
    if (!slugWasEdited) slugInput.value = slugify(titleInput.value);
  });

  slugInput.addEventListener("input", () => {
    slugWasEdited = slugInput.value !== slugify(titleInput.value);
  });

  loglineInput.addEventListener("input", () => {
    loglineCount.textContent = String(loglineInput.value.length);
  });

  posterInput.addEventListener("change", () => {
    summarizeFile(posterInput, posterSummary, "Choose a JPG, PNG, or WebP file.");
  });

  previewInput.addEventListener("change", () => {
    summarizeFile(previewInput, previewSummary, "Choose an MP4 or WebM file.");
  });

  form.addEventListener("submit", reviewDraft);
  }

  global.PaceAdmin = Object.freeze({ initialize });
})(window);
