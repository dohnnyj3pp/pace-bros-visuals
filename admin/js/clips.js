(function exposeClipsWorkspace(global) {
  "use strict";

  const MAX_CLIP_BYTES = 95_000_000;
  const CLIP_COLUMNS = [
    "id",
    "film_id",
    "name",
    "video_key",
    "original_filename",
    "notes",
    "status",
    "duration_seconds",
    "width",
    "height",
    "aspect_ratio",
    "tags",
    "created_at",
    "updated_at",
  ].join(", ");
  const CAPTION_COLUMNS = [
    "id",
    "clip_id",
    "caption",
    "sort_order",
    "created_at",
    "updated_at",
  ].join(", ");

  function createController({ client, workerBaseUrl } = {}) {
    const state = {
      clips: [],
      films: [],
      captionsByClip: new Map(),
      loaded: false,
      loading: false,
      busy: false,
      editingId: "",
      selectedMetadata: null,
      metadataPromise: null,
    };

    const elements = {
      view: document.querySelector("#clips-view"),
      addButton: document.querySelector("#add-clip-button"),
      feedback: document.querySelector("#clips-feedback"),
      tableBody: document.querySelector("#clip-table-body"),
      libraryState: document.querySelector("#clips-library-state"),
      editor: document.querySelector("#clip-editor"),
      editorEyebrow: document.querySelector("#clip-editor-eyebrow"),
      editorHeading: document.querySelector("#clip-editor-heading"),
      closeEditor: document.querySelector("#close-clip-editor"),
      cancelEdit: document.querySelector("#cancel-clip-edit"),
      form: document.querySelector("#clip-form"),
      id: document.querySelector("#clip-id"),
      videoKey: document.querySelector("#clip-video-key"),
      filmId: document.querySelector("#clip-film-id"),
      filmHelp: document.querySelector("#clip-film-help"),
      name: document.querySelector("#clip-name"),
      videoField: document.querySelector("#clip-video-field"),
      videoFile: document.querySelector("#clip-video-file"),
      videoSummary: document.querySelector("#clip-video-summary"),
      metadata: document.querySelector("#clip-media-metadata"),
      metadataDuration: document.querySelector("#clip-metadata-duration"),
      metadataDimensions: document.querySelector("#clip-metadata-dimensions"),
      metadataAspect: document.querySelector("#clip-metadata-aspect"),
      notes: document.querySelector("#clip-notes"),
      status: document.querySelector("#clip-status"),
      tags: document.querySelector("#clip-tags"),
      captionFields: document.querySelector("#caption-fields"),
      captionEmpty: document.querySelector("#caption-empty"),
      addCaption: document.querySelector("#add-caption-button"),
      formFeedback: document.querySelector("#clip-form-feedback"),
      saveButton: document.querySelector("#save-clip-button"),
    };

    if (!client || !elements.view) {
      return { ensureLoaded() {} };
    }

    function setFeedback(element, message = "", kind = "") {
      element.textContent = message;
      element.className = `feedback${kind ? ` is-${kind}` : ""}`;
    }

    function getClip(clipId) {
      return state.clips.find((clip) => clip.id === clipId) || null;
    }

    function getFilmTitle(filmId) {
      return state.films.find((film) => film.id === filmId)?.title || "Unknown film";
    }

    function renderFilmOptions(selectedId = "") {
      elements.filmId.replaceChildren();

      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = state.films.length ? "Choose a film" : "No films available";
      elements.filmId.append(emptyOption);

      state.films.forEach((film) => {
        const option = document.createElement("option");
        option.value = film.id;
        option.textContent = film.title;
        elements.filmId.append(option);
      });

      elements.filmId.value = selectedId;
    }

    function makeAction(label, action, clipId, muted = false) {
      const button = document.createElement("button");
      button.className = `table-action${muted ? " table-action-muted" : ""}`;
      button.type = "button";
      button.dataset.action = action;
      button.dataset.clipId = clipId;
      button.textContent = label;
      return button;
    }

    function renderLibrary() {
      elements.tableBody.replaceChildren();
      elements.libraryState.hidden = state.clips.length > 0;
      elements.libraryState.textContent = state.clips.length
        ? ""
        : "No promotional clips yet. Add the first clip to begin the library.";

      state.clips.forEach((clip) => {
        const row = document.createElement("tr");
        const captions = state.captionsByClip.get(clip.id) || [];
        const cells = [
          ["Clip", clip.name],
          ["Parent Film", getFilmTitle(clip.film_id)],
          ["Duration", formatDuration(clip.duration_seconds)],
          ["Aspect", clip.aspect_ratio || "—"],
          ["Captions", String(captions.length)],
          ["Status", ""],
          ["Created", formatDate(clip.created_at)],
          ["Actions", ""],
        ].map(([label, value]) => {
          const cell = document.createElement("td");
          cell.dataset.label = label;
          if (value) cell.textContent = value;
          return cell;
        });

        const title = document.createElement("strong");
        title.textContent = clip.name;
        cells[0].replaceChildren(title);

        const status = document.createElement("span");
        status.className = `status-badge is-${clip.status}`;
        status.textContent = clip.status === "archived" ? "Archived" : "Active";
        cells[5].append(status);

        cells[7].className = "clip-actions";
        cells[7].append(
          makeAction("Edit", "edit", clip.id),
          makeAction(clip.status === "active" ? "Archive" : "Activate", "toggle-status", clip.id, true),
          makeAction("Delete", "delete", clip.id, true),
        );

        row.append(...cells);
        elements.tableBody.append(row);
      });

      setBusy(state.busy);
    }

    async function loadLibrary({ force = false } = {}) {
      if (state.loading || (state.loaded && !force)) return;

      state.loading = true;
      elements.addButton.disabled = true;
      elements.libraryState.hidden = false;
      elements.libraryState.textContent = "Loading clips…";
      setFeedback(elements.feedback);

      try {
        const [filmsResult, clipsResult, captionsResult] = await Promise.all([
          client
            .from("films")
            .select("id, title, sort_order")
            .order("sort_order", { ascending: true })
            .order("title", { ascending: true }),
          client
            .from("clips")
            .select(CLIP_COLUMNS)
            .order("created_at", { ascending: false }),
          client
            .from("clip_captions")
            .select(CAPTION_COLUMNS)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true }),
        ]);

        const error = filmsResult.error || clipsResult.error || captionsResult.error;
        if (error) throw error;

        state.films = filmsResult.data || [];
        state.clips = clipsResult.data || [];
        state.captionsByClip = groupCaptions(captionsResult.data || []);
        state.loaded = true;
        renderFilmOptions();
        renderLibrary();
      } catch (error) {
        state.loaded = false;
        state.clips = [];
        state.captionsByClip = new Map();
        renderLibrary();
        elements.libraryState.hidden = false;
        elements.libraryState.textContent = "The Clips Library could not be loaded.";
        setFeedback(
          elements.feedback,
          readableError(error, "Run the Clips Library migration, then try again."),
          "error",
        );
      } finally {
        state.loading = false;
        setBusy(state.busy);
      }
    }

    function appendCaptionField(caption = null) {
      const row = document.createElement("div");
      row.className = "caption-field";
      if (caption?.id) row.dataset.captionId = caption.id;

      const label = document.createElement("label");
      const labelText = document.createElement("span");
      const textarea = document.createElement("textarea");
      labelText.className = "caption-label";
      textarea.rows = 2;
      textarea.maxLength = 2200;
      textarea.value = caption?.caption || "";
      textarea.placeholder = "Write a reusable caption variant.";
      label.append(labelText, textarea);

      const actions = document.createElement("div");
      actions.className = "caption-actions";
      [
        ["Move up", "up"],
        ["Move down", "down"],
        ["Remove", "remove"],
      ].forEach(([text, action]) => {
        const button = document.createElement("button");
        button.className = "text-button";
        button.type = "button";
        button.dataset.captionAction = action;
        button.textContent = text;
        actions.append(button);
      });

      row.append(label, actions);
      elements.captionFields.append(row);
      updateCaptionRows();
      textarea.focus({ preventScroll: true });
    }

    function updateCaptionRows() {
      const rows = Array.from(elements.captionFields.children);
      elements.captionEmpty.hidden = rows.length > 0;

      rows.forEach((row, index) => {
        row.querySelector(".caption-label").textContent = `Caption ${index + 1}`;
        row.querySelector('[data-caption-action="up"]').disabled = state.busy || index === 0;
        row.querySelector('[data-caption-action="down"]').disabled = state.busy || index === rows.length - 1;
        row.querySelector('[data-caption-action="remove"]').disabled = state.busy;
      });
    }

    function clearCaptionFields() {
      elements.captionFields.replaceChildren();
      updateCaptionRows();
    }

    function displayMetadata(metadata) {
      const hasMetadata = Boolean(
        metadata?.durationSeconds || (metadata?.width && metadata?.height) || metadata?.aspectRatio,
      );
      elements.metadata.hidden = !hasMetadata;
      elements.metadataDuration.textContent = formatDuration(metadata?.durationSeconds);
      elements.metadataDimensions.textContent = metadata?.width && metadata?.height
        ? `${metadata.width} × ${metadata.height}`
        : "—";
      elements.metadataAspect.textContent = metadata?.aspectRatio || "—";
    }

    function openEditor(clip = null) {
      if (!state.films.length) {
        setFeedback(elements.feedback, "Add a film before creating a promotional clip.", "error");
        return;
      }

      state.editingId = clip?.id || "";
      state.metadataPromise = null;
      state.selectedMetadata = clip
        ? metadataFromClip(clip)
        : null;

      elements.form.reset();
      elements.form.classList.remove("was-validated");
      setFeedback(elements.formFeedback);
      clearCaptionFields();

      elements.id.value = clip?.id || "";
      elements.videoKey.value = clip?.video_key || "";
      renderFilmOptions(clip?.film_id || "");
      elements.name.value = clip?.name || "";
      elements.notes.value = clip?.notes || "";
      elements.status.value = clip?.status || "active";
      elements.tags.value = Array.isArray(clip?.tags) ? clip.tags.join(", ") : "";

      const isEditing = Boolean(clip);
      elements.filmId.disabled = isEditing;
      elements.filmHelp.textContent = isEditing
        ? "Parent film is locked after upload so the R2 media path remains valid."
        : "The film that owns this promotional clip.";
      elements.videoField.hidden = isEditing;
      elements.videoFile.required = !isEditing;
      elements.videoSummary.textContent = "Choose the finished MP4 clip.";
      elements.editorEyebrow.textContent = isEditing ? "Edit clip" : "New clip";
      elements.editorHeading.textContent = isEditing ? clip.name : "Add Clip";
      elements.saveButton.textContent = isEditing ? "Save Changes" : "Save Clip";
      displayMetadata(state.selectedMetadata);

      const captions = clip ? state.captionsByClip.get(clip.id) || [] : [];
      captions.forEach(appendCaptionField);
      if (!isEditing && !captions.length) appendCaptionField();

      elements.editor.hidden = false;
      setBusy(false);
      elements.name.focus({ preventScroll: true });
      elements.editor.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function closeEditor() {
      if (state.busy) return;
      state.editingId = "";
      state.selectedMetadata = null;
      state.metadataPromise = null;
      elements.editor.hidden = true;
      elements.form.reset();
      elements.form.classList.remove("was-validated");
      clearCaptionFields();
      displayMetadata(null);
      setFeedback(elements.formFeedback);
      elements.addButton.focus({ preventScroll: true });
    }

    function setBusy(isBusy) {
      state.busy = isBusy;
      elements.form.setAttribute("aria-busy", String(isBusy));
      elements.form.querySelectorAll("button, input, textarea, select").forEach((control) => {
        control.disabled = isBusy;
      });
      elements.filmId.disabled = isBusy || Boolean(state.editingId);
      elements.closeEditor.disabled = isBusy;
      elements.addButton.disabled = isBusy || state.loading;
      elements.tableBody.querySelectorAll("button").forEach((button) => {
        button.disabled = isBusy;
      });
      elements.saveButton.textContent = isBusy
        ? "Saving…"
        : state.editingId
          ? "Save Changes"
          : "Save Clip";
      updateCaptionRows();
    }

    async function handleVideoSelection() {
      const file = elements.videoFile.files[0] || null;
      state.selectedMetadata = null;
      displayMetadata(null);
      setFeedback(elements.formFeedback);

      if (!file) {
        elements.videoSummary.textContent = "Choose the finished MP4 clip.";
        state.metadataPromise = null;
        return;
      }

      elements.videoSummary.textContent = `${file.name} · ${formatBytes(file.size)} · Reading metadata…`;

      try {
        validateClip(file);
      } catch (error) {
        elements.videoFile.value = "";
        elements.videoSummary.textContent = "Choose the finished MP4 clip.";
        setFeedback(elements.formFeedback, error.message, "error");
        return;
      }

      state.metadataPromise = inspectVideo(file)
        .then((metadata) => {
          state.selectedMetadata = metadata;
          displayMetadata(metadata);
          elements.videoSummary.textContent = `${file.name} · ${formatBytes(file.size)}`;
          return metadata;
        })
        .catch(() => {
          state.selectedMetadata = null;
          elements.videoSummary.textContent = `${file.name} · ${formatBytes(file.size)}`;
          setFeedback(
            elements.formFeedback,
            "The MP4 is selected, but its metadata could not be read. It can still be uploaded.",
            "warning",
          );
          return null;
        });

      await state.metadataPromise;
    }

    function collectCaptionDrafts() {
      return Array.from(elements.captionFields.querySelectorAll(".caption-field"))
        .map((row, sortOrder) => ({
          id: row.dataset.captionId || createUuid(),
          caption: row.querySelector("textarea").value.trim(),
          sort_order: sortOrder,
        }))
        .filter((item) => item.caption);
    }

    async function syncCaptions(clipId, drafts) {
      const existing = state.captionsByClip.get(clipId) || [];
      let saved = [];

      if (drafts.length) {
        const result = await client
          .from("clip_captions")
          .upsert(
            drafts.map((draft) => ({ ...draft, clip_id: clipId })),
            { onConflict: "id" },
          )
          .select(CAPTION_COLUMNS);
        if (result.error) throw result.error;
        saved = (result.data || []).sort(compareCaptions);
      }

      const retainedIds = new Set(drafts.map((draft) => draft.id));
      const removedIds = existing
        .filter((caption) => !retainedIds.has(caption.id))
        .map((caption) => caption.id);

      if (removedIds.length) {
        const result = await client
          .from("clip_captions")
          .delete()
          .eq("clip_id", clipId)
          .in("id", removedIds);
        if (result.error) throw result.error;
      }

      state.captionsByClip.set(clipId, saved);
    }

    async function getAccessToken() {
      const { data, error } = await client.auth.getSession();
      if (error || !data.session?.access_token) {
        throw new Error("Your administrator session has expired. Log in again before managing media.");
      }
      return data.session.access_token;
    }

    async function uploadClip(file, filmId, accessToken) {
      if (!workerBaseUrl) {
        throw new Error("Clip uploads are not configured. Add the deployed Worker URL in js/config.js.");
      }

      const response = await global.fetch(`${workerBaseUrl}/upload/clip`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "video/mp4",
          "X-Film-Id": filmId,
        },
        body: file,
      });
      const result = await parseResponseBody(response);
      if (!response.ok || !result?.key) {
        throw new Error(result?.error?.message || `Clip upload failed (${response.status}).`);
      }
      return result.key;
    }

    async function deleteMedia(objectKey, accessToken) {
      if (!workerBaseUrl) {
        throw new Error("Clip media deletion is not configured. Add the deployed Worker URL in js/config.js.");
      }
      if (!objectKey) throw new Error("This clip has no R2 object key to remove.");

      const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
      const response = await global.fetch(`${workerBaseUrl}/media/${encodedKey}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok && response.status !== 404) {
        const result = await parseResponseBody(response);
        throw new Error(result?.error?.message || `Clip media cleanup failed (${response.status}).`);
      }
    }

    async function saveClip(event) {
      event.preventDefault();
      if (state.busy) return;

      elements.form.classList.add("was-validated");
      setFeedback(elements.formFeedback);
      if (!elements.form.reportValidity()) return;

      const existing = getClip(state.editingId);
      const file = elements.videoFile.files[0] || null;
      const clipName = elements.name.value.trim();
      if (!clipName) {
        setFeedback(elements.formFeedback, "Enter a clip name before saving.", "error");
        elements.name.focus();
        return;
      }
      if (!existing && !file) {
        setFeedback(elements.formFeedback, "Choose an MP4 clip before saving.", "error");
        return;
      }

      try {
        if (file) validateClip(file);
      } catch (error) {
        setFeedback(elements.formFeedback, error.message, "error");
        return;
      }

      setBusy(true);
      let uploadedKey = "";
      let recordSaved = false;
      let accessToken = "";
      let persistedClip = null;

      try {
        if (state.metadataPromise) await state.metadataPromise;

        const clipId = existing?.id || createUuid();
        const filmId = existing?.film_id || elements.filmId.value;
        let videoKey = existing?.video_key || "";

        if (!existing) {
          setFeedback(elements.formFeedback, "Uploading clip to the private media library…");
          accessToken = await getAccessToken();
          uploadedKey = await uploadClip(file, filmId, accessToken);
          videoKey = uploadedKey;
        }

        const metadata = existing ? metadataFromClip(existing) : state.selectedMetadata;
        const payload = {
          film_id: filmId,
          name: clipName,
          video_key: videoKey,
          original_filename: existing?.original_filename || file?.name || null,
          notes: elements.notes.value.trim() || null,
          status: elements.status.value === "archived" ? "archived" : "active",
          duration_seconds: finitePositive(metadata?.durationSeconds),
          width: positiveInteger(metadata?.width),
          height: positiveInteger(metadata?.height),
          aspect_ratio: metadata?.aspectRatio || null,
          tags: parseTags(elements.tags.value),
        };

        setFeedback(elements.formFeedback, existing ? "Saving clip changes…" : "Saving clip record…");
        const query = existing
          ? client.from("clips").update(payload).eq("id", clipId)
          : client.from("clips").insert({ id: clipId, ...payload });
        const result = await query.select(CLIP_COLUMNS).single();
        if (result.error || !result.data) {
          throw result.error || new Error("The saved clip record was not returned.");
        }

        recordSaved = true;
        const savedClip = result.data;
        persistedClip = savedClip;
        const drafts = collectCaptionDrafts();
        setFeedback(elements.formFeedback, "Saving caption bank…");
        await syncCaptions(savedClip.id, drafts);

        const index = state.clips.findIndex((clip) => clip.id === savedClip.id);
        if (index >= 0) state.clips[index] = savedClip;
        else state.clips.unshift(savedClip);
        state.clips.sort(compareClips);
        renderLibrary();

        state.editingId = "";
        state.selectedMetadata = null;
        state.metadataPromise = null;
        elements.editor.hidden = true;
        setFeedback(
          elements.feedback,
          `${savedClip.name} was ${existing ? "updated" : "added to the Clips Library"}.`,
          "success",
        );
      } catch (error) {
        let cleanupWarning = false;
        if (uploadedKey && !recordSaved) {
          try {
            accessToken ||= await getAccessToken();
            await deleteMedia(uploadedKey, accessToken);
          } catch {
            cleanupWarning = true;
          }
        }

        const partialMessage = recordSaved
          ? " The clip record was saved, but its caption bank was not fully saved. Reopen the clip and try again."
          : "";
        const cleanupMessage = cleanupWarning
          ? " The uploaded R2 object could not be cleaned up and may need manual removal."
          : "";
        if (recordSaved) {
          state.loaded = false;
          await loadLibrary({ force: true });
          openEditor(getClip(persistedClip?.id) || persistedClip);
        }

        setFeedback(
          elements.formFeedback,
          `${readableError(error, "The clip could not be saved.")}${partialMessage}${cleanupMessage}`,
          "error",
        );
      } finally {
        setBusy(false);
      }
    }

    async function toggleStatus(clip) {
      if (state.busy) return;
      const status = clip.status === "active" ? "archived" : "active";
      setBusy(true);
      setFeedback(elements.feedback, status === "active" ? "Activating clip…" : "Archiving clip…");

      try {
        const result = await client
          .from("clips")
          .update({ status })
          .eq("id", clip.id)
          .select(CLIP_COLUMNS)
          .single();
        if (result.error || !result.data) {
          throw result.error || new Error("The updated clip record was not returned.");
        }
        const index = state.clips.findIndex((item) => item.id === clip.id);
        state.clips[index] = result.data;
        renderLibrary();
        setFeedback(elements.feedback, `${clip.name} is now ${status}.`, "success");
      } catch (error) {
        renderLibrary();
        setFeedback(elements.feedback, readableError(error, "The clip status could not be changed."), "error");
      } finally {
        setBusy(false);
      }
    }

    async function deleteClip(clip) {
      if (state.busy) return;
      const confirmed = global.confirm(
        `Delete “${clip.name}”? This permanently removes its R2 video, metadata, and captions.`,
      );
      if (!confirmed) return;

      setBusy(true);
      setFeedback(elements.feedback, "Removing clip media from R2…");

      try {
        const accessToken = await getAccessToken();
        await deleteMedia(clip.video_key, accessToken);

        setFeedback(elements.feedback, "Removing clip record and captions…");
        const result = await client.from("clips").delete().eq("id", clip.id);
        if (result.error) {
          throw new Error(
            `${result.error.message} The R2 video was removed, but the database record remains and may need manual cleanup.`,
          );
        }

        state.clips = state.clips.filter((item) => item.id !== clip.id);
        state.captionsByClip.delete(clip.id);
        renderLibrary();
        setFeedback(elements.feedback, `${clip.name} and its media were deleted.`, "success");
      } catch (error) {
        renderLibrary();
        setFeedback(
          elements.feedback,
          `${readableError(error, "The clip could not be deleted.")} No database deletion was reported as successful.`,
          "error",
        );
      } finally {
        setBusy(false);
      }
    }

    elements.addButton.addEventListener("click", () => openEditor());
    elements.closeEditor.addEventListener("click", closeEditor);
    elements.cancelEdit.addEventListener("click", closeEditor);
    elements.form.addEventListener("submit", saveClip);
    elements.videoFile.addEventListener("change", handleVideoSelection);
    elements.addCaption.addEventListener("click", () => appendCaptionField());

    elements.captionFields.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-caption-action]");
      if (!button || state.busy) return;
      const row = button.closest(".caption-field");
      const action = button.dataset.captionAction;

      if (action === "remove") row.remove();
      if (action === "up" && row.previousElementSibling) {
        elements.captionFields.insertBefore(row, row.previousElementSibling);
      }
      if (action === "down" && row.nextElementSibling) {
        elements.captionFields.insertBefore(row.nextElementSibling, row);
      }
      updateCaptionRows();
    });

    elements.tableBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-clip-id]");
      if (!button || state.busy) return;
      const clip = getClip(button.dataset.clipId);
      if (!clip) return;
      if (button.dataset.action === "edit") openEditor(clip);
      if (button.dataset.action === "toggle-status") toggleStatus(clip);
      if (button.dataset.action === "delete") deleteClip(clip);
    });

    return {
      ensureLoaded() {
        return loadLibrary();
      },
    };
  }

  function groupCaptions(captions) {
    const grouped = new Map();
    captions.forEach((caption) => {
      const group = grouped.get(caption.clip_id) || [];
      group.push(caption);
      grouped.set(caption.clip_id, group);
    });
    grouped.forEach((group) => group.sort(compareCaptions));
    return grouped;
  }

  function compareCaptions(first, second) {
    return Number(first.sort_order || 0) - Number(second.sort_order || 0)
      || String(first.created_at || "").localeCompare(String(second.created_at || ""));
  }

  function compareClips(first, second) {
    return String(second.created_at || "").localeCompare(String(first.created_at || ""))
      || first.name.localeCompare(second.name);
  }

  function metadataFromClip(clip) {
    return {
      durationSeconds: finitePositive(clip?.duration_seconds),
      width: positiveInteger(clip?.width),
      height: positiveInteger(clip?.height),
      aspectRatio: clip?.aspect_ratio || null,
    };
  }

  function inspectVideo(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const objectUrl = URL.createObjectURL(file);
      const timer = global.setTimeout(() => finish(new Error("Metadata reading timed out.")), 15000);
      let complete = false;

      function finish(error = null) {
        if (complete) return;
        complete = true;
        global.clearTimeout(timer);

        let metadata = null;
        if (!error) {
          const measuredWidth = positiveInteger(video.videoWidth);
          const measuredHeight = positiveInteger(video.videoHeight);
          const width = measuredWidth && measuredHeight ? measuredWidth : null;
          const height = measuredWidth && measuredHeight ? measuredHeight : null;
          metadata = {
            durationSeconds: finitePositive(video.duration),
            width,
            height,
            aspectRatio: width && height ? ratioLabel(width, height) : null,
          };
        }

        URL.revokeObjectURL(objectUrl);
        video.removeAttribute("src");
        video.load();
        if (error) {
          reject(error);
          return;
        }
        resolve(metadata);
      }

      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => finish();
      video.onerror = () => finish(new Error("MP4 metadata could not be read."));
      video.src = objectUrl;
    });
  }

  function ratioLabel(width, height) {
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
  }

  function greatestCommonDivisor(first, second) {
    let a = Math.abs(first);
    let b = Math.abs(second);
    while (b) [a, b] = [b, a % b];
    return a || 1;
  }

  function parseTags(value) {
    return Array.from(
      new Set(
        String(value || "")
          .split(",")
          .map((tag) => tag.trim().replace(/^#+/, "").toLowerCase())
          .filter(Boolean),
      ),
    );
  }

  function validateClip(file) {
    if (file.type !== "video/mp4") throw new Error("Clip video must be an MP4 file.");
    if (file.size < 1) throw new Error("Clip video is empty.");
    if (file.size > MAX_CLIP_BYTES) {
      throw new Error("Clip video is larger than the 95 MB single-request upload limit.");
    }
  }

  function finitePositive(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(3)) : null;
  }

  function positiveInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function formatDuration(value) {
    const seconds = finitePositive(value);
    if (!seconds) return "—";
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1) return "0 bytes";
    const units = ["bytes", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function createUuid() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Array.from(bytes, (byte, index) => {
      const separator = [4, 6, 8, 10].includes(index) ? "-" : "";
      return `${separator}${byte.toString(16).padStart(2, "0")}`;
    }).join("");
  }

  async function parseResponseBody(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function readableError(error, fallback) {
    const message = typeof error?.message === "string" ? error.message.trim() : "";
    return message || fallback;
  }

  global.PaceAdminClips = Object.freeze({ createController });
})(window);
