(function exposeAdminWorkspace(global) {
  "use strict";

  const MAX_SINGLE_UPLOAD_BYTES = 95_000_000;
  const MULTIPART_CHUNK_BYTES = 16 * 1024 * 1024;
  const MAX_MULTIPART_PARTS = 10_000;

  const POSTER_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

  const VIDEO_TYPES = new Set([
    "video/mp4",
  ]);

  const FILM_COLUMNS = [
    "id",
    "title",
    "description",
    "video_key",
    "poster_key",
    "published",
    "sort_order",
    "created_at",
    "updated_at",
  ].join(", ");

  let initialized = false;

  function initialize({ user, adminProfile } = {}) {
    if (initialized) return;
    initialized = true;

    const client = global.PaceSupabase;
    const workerBaseUrl = getWorkerBaseUrl();

    const state = {
      films: [],
      formBusy: false,
      libraryBusy: false,
    };

    const elements = {
      navItems: Array.from(
        document.querySelectorAll("[data-view]"),
      ),
      views: Array.from(
        document.querySelectorAll("[data-workspace-view]"),
      ),
      filmsView: document.querySelector("#films-view"),
      clipsView: document.querySelector("#clips-view"),
      socialMediaView: document.querySelector("#social-media-view"),
      analyticsView: document.querySelector("#analytics-view"),
      placeholderView: document.querySelector("#placeholder-view"),
      settingsView: document.querySelector("#settings-view"),
      placeholderEyebrow: document.querySelector(
        "#placeholder-eyebrow",
      ),
      placeholderTitle: document.querySelector(
        "#placeholder-title",
      ),
      placeholderCopy: document.querySelector(
        "#placeholder-copy",
      ),
      connectionLabel: document.querySelector(
        "#connection-label",
      ),
      addFilmButton: document.querySelector(
        "#add-film-button",
      ),
      libraryFeedback: document.querySelector(
        "#library-feedback",
      ),
      libraryState: document.querySelector(
        "#library-state",
      ),
      filmTableBody: document.querySelector(
        "#film-table-body",
      ),
      editor: document.querySelector("#film-editor"),
      editorEyebrow: document.querySelector(
        "#editor-eyebrow",
      ),
      editorHeading: document.querySelector(
        "#editor-heading",
      ),
      closeEditorButton: document.querySelector(
        "#close-editor-button",
      ),
      cancelEditButton: document.querySelector(
        "#cancel-edit-button",
      ),
      form: document.querySelector("#film-form"),
      filmId: document.querySelector("#film-id"),
      title: document.querySelector("#title"),
      description: document.querySelector("#description"),
      posterInput: document.querySelector("#poster-file"),
      videoInput: document.querySelector("#video-file"),
      posterSummary: document.querySelector(
        "#poster-summary",
      ),
      videoSummary: document.querySelector(
        "#video-summary",
      ),
      currentPosterKey: document.querySelector(
        "#current-poster-key",
      ),
      currentVideoKey: document.querySelector(
        "#current-video-key",
      ),
      publicationStatus: document.querySelector(
        "#publication-status",
      ),
      sortOrder: document.querySelector("#sort-order"),
      formFeedback: document.querySelector(
        "#form-feedback",
      ),
      saveDraftButton: document.querySelector(
        "#save-draft-button",
      ),
      publishFilmButton: document.querySelector(
        "#publish-film-button",
      ),
      settingsName: document.querySelector(
        "#settings-name",
      ),
      settingsEmail: document.querySelector(
        "#settings-email",
      ),
      settingsWorker: document.querySelector(
        "#settings-worker",
      ),
    };

    const displayName =
      adminProfile?.display_name ||
      "Authorized administrator";

    elements.connectionLabel.textContent = displayName;
    elements.settingsName.textContent = displayName;
    elements.settingsEmail.textContent =
      user?.email || "Not available";
    elements.settingsWorker.textContent =
      workerBaseUrl ? "Configured" : "Not configured";

    const analyticsController =
      global.PaceAdminAnalytics?.createController({
        client,
        workerBaseUrl,
      }) || { ensureLoaded() {} };

    const clipsController =
      global.PaceAdminClips?.createController({
        client,
        workerBaseUrl,
      }) || { ensureLoaded() {} };

    const socialController =
      global.PaceAdminSocial?.createController({
        client,
        workerBaseUrl,
      }) || { ensureLoaded() {}, hasPendingCallback: () => false };

    function getFilm(filmId) {
      return (
        state.films.find(
          (film) => film.id === filmId,
        ) || null
      );
    }

    function setFeedback(
      element,
      message = "",
      kind = "",
    ) {
      element.textContent = message;
      element.className =
        `feedback${kind ? ` is-${kind}` : ""}`;
    }

    function setFormBusy(
      isBusy,
      label = "",
    ) {
      state.formBusy = isBusy;

      elements.form.setAttribute(
        "aria-busy",
        String(isBusy),
      );

      elements.form
        .querySelectorAll(
          "button, input, textarea, select",
        )
        .forEach((control) => {
          control.disabled = isBusy;
        });

      elements.closeEditorButton.disabled = isBusy;

      elements.saveDraftButton.textContent =
        isBusy && label === "draft"
          ? "Saving…"
          : "Save Draft";

      elements.publishFilmButton.textContent =
        isBusy && label === "publish"
          ? "Publishing…"
          : "Publish Film";
    }

    function showView(viewName) {
      const isPlaceholder = viewName === "automation";

      const targetView = isPlaceholder
        ? elements.placeholderView
        : viewName === "clips"
          ? elements.clipsView
          : viewName === "social-media"
            ? elements.socialMediaView
          : viewName === "analytics"
            ? elements.analyticsView
            : viewName === "settings"
              ? elements.settingsView
              : elements.filmsView;

      elements.views.forEach((view) => {
        view.hidden = view !== targetView;
      });

      elements.navItems.forEach((item) => {
        const isActive =
          item.dataset.view === viewName;

        item.classList.toggle(
          "is-active",
          isActive,
        );

        item.setAttribute(
          "aria-current",
          isActive ? "page" : "false",
        );
      });

      if (viewName === "analytics") {
        analyticsController.ensureLoaded();
        return;
      }

      if (viewName === "clips") {
        clipsController.ensureLoaded();
        return;
      }

      if (viewName === "social-media") {
        socialController.ensureLoaded();
        return;
      }

      if (!isPlaceholder) return;

      const placeholders = {
        automation: [
          "Publishing",
          "Automation",
        ],
      };

      const [section, title] =
        placeholders[viewName];

      elements.placeholderEyebrow.textContent =
        section;

      elements.placeholderTitle.textContent =
        title;

      elements.placeholderCopy.textContent =
        "Coming soon.";
    }

    function renderFilmTable() {
      elements.filmTableBody.replaceChildren();

      elements.libraryState.hidden =
        state.films.length > 0;

      elements.libraryState.textContent =
        state.films.length
          ? ""
          : "No films yet. Add the first film to begin the catalogue.";

      state.films.forEach((film) => {
        const row =
          document.createElement("tr");

        const titleCell =
          document.createElement("td");

        const statusCell =
          document.createElement("td");

        const actionCell =
          document.createElement("td");

        const title =
          document.createElement("strong");

        const status =
          document.createElement("span");

        const editButton =
          document.createElement("button");

        const statusButton =
          document.createElement("button");

        title.textContent = film.title;
        titleCell.append(title);

        status.className =
          `status-badge ${
            film.published
              ? "is-published"
              : "is-draft"
          }`;

        status.textContent =
          film.published
            ? "Published"
            : "Draft";

        statusCell.append(status);

        actionCell.className =
          "film-actions";

        editButton.className =
          "table-action";

        editButton.type =
          "button";

        editButton.dataset.action =
          "edit";

        editButton.dataset.filmId =
          film.id;

        editButton.textContent =
          "Edit";

        statusButton.className =
          "table-action table-action-muted";

        statusButton.type =
          "button";

        statusButton.dataset.action =
          "toggle-status";

        statusButton.dataset.filmId =
          film.id;

        statusButton.textContent =
          film.published
            ? "Return to Draft"
            : "Publish";

        actionCell.append(
          editButton,
          statusButton,
        );

        row.append(
          titleCell,
          statusCell,
          actionCell,
        );

        elements.filmTableBody.append(row);
      });
    }

    async function loadFilms() {
      if (
        !client ||
        state.libraryBusy
      ) {
        return;
      }

      state.libraryBusy = true;

      elements.libraryState.hidden =
        false;

      elements.libraryState.textContent =
        "Loading films…";

      setFeedback(
        elements.libraryFeedback,
      );

      try {
        const {
          data,
          error,
        } = await client
          .from("films")
          .select(FILM_COLUMNS)
          .order(
            "sort_order",
            { ascending: true },
          )
          .order(
            "created_at",
            { ascending: true },
          );

        if (error) throw error;

        state.films =
          data || [];

        renderFilmTable();
      } catch (error) {
        state.films = [];

        renderFilmTable();

        elements.libraryState.hidden =
          false;

        elements.libraryState.textContent =
          "The film library could not be loaded.";

        setFeedback(
          elements.libraryFeedback,
          readableError(
            error,
            "Check the Supabase films migration and try again.",
          ),
          "error",
        );
      } finally {
        state.libraryBusy = false;
      }
    }

    function openEditor(
      film = null,
    ) {
      elements.form.reset();

      elements.form.classList.remove(
        "was-validated",
      );

      setFeedback(
        elements.formFeedback,
      );

      elements.filmId.value =
        film?.id || "";

      elements.title.value =
        film?.title || "";

      elements.description.value =
        film?.description || "";

      elements.currentPosterKey.value =
        film?.poster_key || "";

      elements.currentVideoKey.value =
        film?.video_key || "";

      elements.publicationStatus.value =
        film?.published
          ? "published"
          : "draft";

      elements.sortOrder.value =
        Number.isInteger(
          film?.sort_order,
        )
          ? String(film.sort_order)
          : "0";

      elements.posterSummary.textContent =
        film?.poster_key
          ? "Current poster will be retained unless a replacement is chosen."
          : "Choose a JPG, PNG, or WebP file.";

      elements.videoSummary.textContent =
        film?.video_key
          ? "Current video will be retained unless a replacement is chosen."
          : "Choose an MP4 file.";

      elements.editorEyebrow.textContent =
        film
          ? "Edit film"
          : "New film";

      elements.editorHeading.textContent =
        film
          ? film.title
          : "Add Film";

      elements.editor.hidden = false;

      elements.title.focus({
        preventScroll: true,
      });

      elements.editor.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }

    function closeEditor() {
      if (state.formBusy) return;

      elements.editor.hidden = true;

      elements.form.reset();

      elements.form.classList.remove(
        "was-validated",
      );

      setFeedback(
        elements.formFeedback,
      );

      elements.addFilmButton.focus({
        preventScroll: true,
      });
    }

    function updateFileSummary(
      input,
      output,
      emptyText,
    ) {
      const file =
        input.files[0];

      output.textContent =
        file
          ? `${file.name} · ${formatBytes(file.size)}`
          : emptyText;
    }

    async function getAccessToken() {
      const {
        data,
        error,
      } =
        await client.auth.getSession();

      if (
        error ||
        !data.session?.access_token
      ) {
        throw new Error(
          "Your administrator session has expired. Log in again before uploading.",
        );
      }

      return data.session.access_token;
    }

    async function uploadMedia(
      kind,
      file,
      filmId,
      accessToken,
      progressCallback = null,
    ) {
      if (!workerBaseUrl) {
        throw new Error(
          "Media uploads are not configured. Add the deployed Worker URL in js/config.js.",
        );
      }

      validateUpload(
        kind,
        file,
      );

      if (
        kind === "video" &&
        file.size >
          MAX_SINGLE_UPLOAD_BYTES
      ) {
        return uploadVideoMultipart(
          file,
          filmId,
          accessToken,
          progressCallback,
        );
      }

      return uploadSingleMedia(
        kind,
        file,
        filmId,
        accessToken,
      );
    }

    async function uploadSingleMedia(
      kind,
      file,
      filmId,
      accessToken,
    ) {
      const response =
        await global.fetch(
          `${workerBaseUrl}/upload/${kind}`,
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${accessToken}`,
              "Content-Type":
                file.type,
              "X-Film-Id":
                filmId,
            },
            body: file,
          },
        );

      const result =
        await parseResponseBody(
          response,
        );

      if (
        !response.ok ||
        !result?.key
      ) {
        throw new Error(
          result?.error?.message ||
          `${capitalize(kind)} upload failed (${response.status}).`,
        );
      }

      return result.key;
    }

    async function uploadVideoMultipart(
      file,
      filmId,
      accessToken,
      progressCallback,
    ) {
      const partCount =
        Math.ceil(
          file.size /
          MULTIPART_CHUNK_BYTES,
        );

      if (
        partCount < 1 ||
        partCount >
          MAX_MULTIPART_PARTS
      ) {
        throw new Error(
          "This video is too large for the multipart uploader.",
        );
      }

      progressCallback?.(
        `Starting multipart video upload (${partCount} parts)…`,
      );

      const createResponse =
        await global.fetch(
          `${workerBaseUrl}/upload/video/multipart/create`,
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${accessToken}`,
              "X-Film-Id":
                filmId,
            },
          },
        );

      const createResult =
        await parseResponseBody(
          createResponse,
        );

      if (
        !createResponse.ok ||
        !createResult?.key ||
        !createResult?.uploadId
      ) {
        throw new Error(
          createResult?.error?.message ||
          `Video multipart upload could not be started (${createResponse.status}).`,
        );
      }

      const objectKey =
        createResult.key;

      const uploadId =
        createResult.uploadId;

      const uploadedParts = [];
      let completed = false;

      try {
        for (
          let index = 0;
          index < partCount;
          index += 1
        ) {
          const partNumber =
            index + 1;

          const start =
            index *
            MULTIPART_CHUNK_BYTES;

          const end =
            Math.min(
              start +
                MULTIPART_CHUNK_BYTES,
              file.size,
            );

          const chunk =
            file.slice(
              start,
              end,
              "video/mp4",
            );

          progressCallback?.(
            `Uploading video part ${partNumber} of ${partCount} (${Math.round((start / file.size) * 100)}%)…`,
          );

          const partUrl =
            new URL(
              `${workerBaseUrl}/upload/video/multipart/part`,
            );

          partUrl.searchParams.set(
            "key",
            objectKey,
          );

          partUrl.searchParams.set(
            "uploadId",
            uploadId,
          );

          partUrl.searchParams.set(
            "partNumber",
            String(partNumber),
          );

          const partResponse =
            await global.fetch(
              partUrl.href,
              {
                method: "PUT",
                headers: {
                  Authorization:
                    `Bearer ${accessToken}`,
                  "Content-Type":
                    "video/mp4",
                },
                body: chunk,
              },
            );

          const partResult =
            await parseResponseBody(
              partResponse,
            );

          if (
            !partResponse.ok ||
            !partResult?.etag ||
            Number(
              partResult.partNumber,
            ) !== partNumber
          ) {
            throw new Error(
              partResult?.error?.message ||
              `Video part ${partNumber} failed (${partResponse.status}).`,
            );
          }

          uploadedParts.push({
            partNumber:
              Number(
                partResult.partNumber,
              ),
            etag:
              partResult.etag,
          });

          progressCallback?.(
            `Uploading video part ${partNumber} of ${partCount} (${Math.round((end / file.size) * 100)}%)…`,
          );
        }

        progressCallback?.(
          "Assembling video in R2…",
        );

        const completeUrl =
          new URL(
            `${workerBaseUrl}/upload/video/multipart/complete`,
          );

        completeUrl.searchParams.set(
          "key",
          objectKey,
        );

        completeUrl.searchParams.set(
          "uploadId",
          uploadId,
        );

        const completeResponse =
          await global.fetch(
            completeUrl.href,
            {
              method: "POST",
              headers: {
                Authorization:
                  `Bearer ${accessToken}`,
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                parts:
                  uploadedParts,
              }),
            },
          );

        const completeResult =
          await parseResponseBody(
            completeResponse,
          );

        if (
          !completeResponse.ok ||
          !completeResult?.key
        ) {
          throw new Error(
            completeResult?.error?.message ||
            `Video multipart upload could not be completed (${completeResponse.status}).`,
          );
        }

        completed = true;

        progressCallback?.(
          "Video upload complete.",
        );

        return completeResult.key;
      } catch (error) {
        if (!completed) {
          await abortMultipartUpload(
            objectKey,
            uploadId,
            accessToken,
          );
        }

        throw error;
      }
    }

    async function abortMultipartUpload(
      objectKey,
      uploadId,
      accessToken,
    ) {
      try {
        const abortUrl =
          new URL(
            `${workerBaseUrl}/upload/video/multipart/abort`,
          );

        abortUrl.searchParams.set(
          "key",
          objectKey,
        );

        abortUrl.searchParams.set(
          "uploadId",
          uploadId,
        );

        const response =
          await global.fetch(
            abortUrl.href,
            {
              method: "DELETE",
              headers: {
                Authorization:
                  `Bearer ${accessToken}`,
              },
            },
          );

        if (
          !response.ok &&
          response.status !== 404
        ) {
          console.warn(
            "Multipart upload cleanup failed.",
            response.status,
          );
        }
      } catch (error) {
        console.warn(
          "Multipart upload cleanup failed.",
          error,
        );
      }
    }

    async function deleteMedia(
      objectKey,
      accessToken,
    ) {
      if (
        !workerBaseUrl ||
        !objectKey
      ) {
        return;
      }

      const encodedKey =
        objectKey
          .split("/")
          .map(encodeURIComponent)
          .join("/");

      const response =
        await global.fetch(
          `${workerBaseUrl}/media/${encodedKey}`,
          {
            method: "DELETE",
            headers: {
              Authorization:
                `Bearer ${accessToken}`,
            },
          },
        );

      if (
        !response.ok &&
        response.status !== 404
      ) {
        const result =
          await parseResponseBody(
            response,
          );

        throw new Error(
          result?.error?.message ||
          `Media cleanup failed (${response.status}).`,
        );
      }
    }

    async function cleanupUploads(
      objectKeys,
      accessToken,
    ) {
      const results =
        await Promise.allSettled(
          objectKeys
            .filter(Boolean)
            .map(
              (objectKey) =>
                deleteMedia(
                  objectKey,
                  accessToken,
                ),
            ),
        );

      return results.some(
        (result) =>
          result.status ===
          "rejected",
      );
    }

    async function saveFilm(event) {
      event.preventDefault();

      if (state.formBusy) return;

      const requestedStatus =
        event.submitter
          ?.dataset.publish;

      const shouldPublish =
        requestedStatus === undefined
          ? elements
              .publicationStatus
              .value === "published"
          : requestedStatus === "true";

      elements.publicationStatus.value =
        shouldPublish
          ? "published"
          : "draft";

      elements.form.classList.add(
        "was-validated",
      );

      setFeedback(
        elements.formFeedback,
      );

      if (
        !elements.form.reportValidity()
      ) {
        return;
      }

      const posterFile =
        elements.posterInput
          .files[0] || null;

      const videoFile =
        elements.videoInput
          .files[0] || null;

      try {
        if (posterFile) {
          validateUpload(
            "poster",
            posterFile,
          );
        }

        if (videoFile) {
          validateUpload(
            "video",
            videoFile,
          );
        }
      } catch (error) {
        setFeedback(
          elements.formFeedback,
          error.message,
          "error",
        );

        return;
      }

      const existingFilm =
        getFilm(
          elements.filmId.value,
        );

      const filmId =
        existingFilm?.id ||
        createUuid();

      const oldPosterKey =
        existingFilm?.poster_key ||
        elements.currentPosterKey
          .value ||
        null;

      const oldVideoKey =
        existingFilm?.video_key ||
        elements.currentVideoKey
          .value ||
        null;

      if (
        shouldPublish &&
        (
          (!posterFile &&
            !oldPosterKey) ||
          (!videoFile &&
            !oldVideoKey)
        )
      ) {
        setFeedback(
          elements.formFeedback,
          "A poster image and MP4 video are required before this film can be published.",
          "error",
        );

        return;
      }

      let posterKey =
        oldPosterKey;

      let videoKey =
        oldVideoKey;

      const uploadedKeys = [];
      let accessToken = "";

      setFormBusy(
        true,
        shouldPublish
          ? "publish"
          : "draft",
      );

      try {
        if (
          posterFile ||
          videoFile
        ) {
          accessToken =
            await getAccessToken();
        }

        if (posterFile) {
          setFeedback(
            elements.formFeedback,
            "Uploading poster…",
          );

          posterKey =
            await uploadMedia(
              "poster",
              posterFile,
              filmId,
              accessToken,
            );

          uploadedKeys.push(
            posterKey,
          );
        }

        if (videoFile) {
          setFeedback(
            elements.formFeedback,
            "Uploading video…",
          );

          videoKey =
            await uploadMedia(
              "video",
              videoFile,
              filmId,
              accessToken,
              (message) => {
                setFeedback(
                  elements.formFeedback,
                  message,
                );
              },
            );

          uploadedKeys.push(
            videoKey,
          );
        }

        if (
          shouldPublish &&
          (
            !posterKey ||
            !videoKey
          )
        ) {
          throw new Error(
            "A poster image and MP4 video are required before this film can be published.",
          );
        }

        setFeedback(
          elements.formFeedback,
          shouldPublish
            ? "Publishing film…"
            : "Saving draft…",
        );

        const payload = {
          title:
            elements.title
              .value
              .trim(),

          description:
            elements.description
              .value
              .trim() ||
            null,

          poster_key:
            posterKey,

          video_key:
            videoKey,

          published:
            shouldPublish,

          sort_order:
            parseSortOrder(
              elements.sortOrder
                .value,
            ),
        };

        const query =
          existingFilm
            ? client
                .from("films")
                .update(payload)
                .eq(
                  "id",
                  filmId,
                )
            : client
                .from("films")
                .insert({
                  id: filmId,
                  ...payload,
                });

        const {
          data: savedFilm,
          error,
        } =
          await query
            .select(
              FILM_COLUMNS,
            )
            .single();

        if (
          error ||
          !savedFilm
        ) {
          throw (
            error ||
            new Error(
              "The film record was not returned after saving.",
            )
          );
        }

        const replacedKeys = [
          posterFile &&
          oldPosterKey !== posterKey
            ? oldPosterKey
            : null,

          videoFile &&
          oldVideoKey !== videoKey
            ? oldVideoKey
            : null,
        ].filter(Boolean);

        let cleanupWarning =
          false;

        if (
          replacedKeys.length
        ) {
          accessToken ||=
            await getAccessToken();

          cleanupWarning =
            await cleanupUploads(
              replacedKeys,
              accessToken,
            );
        }

        const savedIndex =
          state.films.findIndex(
            (film) =>
              film.id ===
              savedFilm.id,
          );

        if (
          savedIndex >= 0
        ) {
          state.films[
            savedIndex
          ] = savedFilm;
        } else {
          state.films.push(
            savedFilm,
          );
        }

        state.films.sort(
          compareFilms,
        );

        renderFilmTable();

        elements.editor.hidden =
          true;

        setFeedback(
          elements.libraryFeedback,
          `${savedFilm.title} was ${
            shouldPublish
              ? "published"
              : "saved as a draft"
          }.${
            cleanupWarning
              ? " An older media file could not be removed."
              : ""
          }`,
          cleanupWarning
            ? "warning"
            : "success",
        );
      } catch (error) {
        let cleanupWarning =
          false;

        if (
          uploadedKeys.length &&
          accessToken
        ) {
          cleanupWarning =
            await cleanupUploads(
              uploadedKeys,
              accessToken,
            );
        }

        const suffix =
          cleanupWarning
            ? " A newly uploaded file could not be removed and may remain in R2."
            : "";

        setFeedback(
          elements.formFeedback,
          `${readableError(
            error,
            "The film could not be saved.",
          )}${suffix}`,
          "error",
        );
      } finally {
        setFormBusy(false);
      }
    }

    async function toggleFilmStatus(
      film,
    ) {
      if (state.libraryBusy) {
        return;
      }

      const nextPublished =
        !film.published;

      if (
        nextPublished &&
        (
          !film.poster_key ||
          !film.video_key
        )
      ) {
        setFeedback(
          elements.libraryFeedback,
          "A poster image and MP4 video are required before this film can be published. Open Edit to add them.",
          "error",
        );

        return;
      }

      state.libraryBusy = true;

      setFeedback(
        elements.libraryFeedback,
        nextPublished
          ? "Publishing film…"
          : "Returning film to draft…",
      );

      elements.filmTableBody
        .querySelectorAll("button")
        .forEach((button) => {
          button.disabled = true;
        });

      try {
        const {
          data: savedFilm,
          error,
        } =
          await client
            .from("films")
            .update({
              published:
                nextPublished,
            })
            .eq(
              "id",
              film.id,
            )
            .select(
              FILM_COLUMNS,
            )
            .single();

        if (
          error ||
          !savedFilm
        ) {
          throw (
            error ||
            new Error(
              "The updated film was not returned.",
            )
          );
        }

        const filmIndex =
          state.films.findIndex(
            (item) =>
              item.id ===
              film.id,
          );

        state.films[
          filmIndex
        ] = savedFilm;

        renderFilmTable();

        setFeedback(
          elements.libraryFeedback,
          `${savedFilm.title} is now ${
            nextPublished
              ? "published"
              : "a draft"
          }.`,
          "success",
        );
      } catch (error) {
        renderFilmTable();

        setFeedback(
          elements.libraryFeedback,
          readableError(
            error,
            "The publication status could not be changed.",
          ),
          "error",
        );
      } finally {
        state.libraryBusy = false;
      }
    }

    elements.navItems.forEach(
      (item) => {
        item.addEventListener(
          "click",
          () =>
            showView(
              item.dataset.view,
            ),
        );
      },
    );

    elements.addFilmButton.addEventListener(
      "click",
      () => openEditor(),
    );

    elements.closeEditorButton.addEventListener(
      "click",
      closeEditor,
    );

    elements.cancelEditButton.addEventListener(
      "click",
      closeEditor,
    );

    elements.form.addEventListener(
      "submit",
      saveFilm,
    );

    elements.posterInput.addEventListener(
      "change",
      () => {
        updateFileSummary(
          elements.posterInput,
          elements.posterSummary,
          elements
            .currentPosterKey
            .value
            ? "Current poster will be retained unless a replacement is chosen."
            : "Choose a JPG, PNG, or WebP file.",
        );
      },
    );

    elements.videoInput.addEventListener(
      "change",
      () => {
        updateFileSummary(
          elements.videoInput,
          elements.videoSummary,
          elements
            .currentVideoKey
            .value
            ? "Current video will be retained unless a replacement is chosen."
            : "Choose an MP4 file.",
        );
      },
    );

    elements.publicationStatus.addEventListener(
      "change",
      () => {
        const publishSelected =
          elements
            .publicationStatus
            .value ===
          "published";

        elements
          .publishFilmButton
          .classList.toggle(
            "is-emphasized",
            publishSelected,
          );

        elements
          .saveDraftButton
          .classList.toggle(
            "is-emphasized",
            !publishSelected,
          );
      },
    );

    elements.filmTableBody.addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            "button[data-film-id]",
          );

        if (!button) return;

        const film =
          getFilm(
            button.dataset
              .filmId,
          );

        if (!film) return;

        if (
          button.dataset.action ===
          "edit"
        ) {
          openEditor(film);
        }

        if (
          button.dataset.action ===
          "toggle-status"
        ) {
          toggleFilmStatus(
            film,
          );
        }
      },
    );

    showView(
      socialController.hasPendingCallback()
        ? "social-media"
        : "films",
    );
    loadFilms();
  }

  function getWorkerBaseUrl() {
    const configuredUrl =
      String(
        global.PaceBrosConfig
          ?.workerBaseUrl ||
        "",
      ).trim();

    if (
      !configuredUrl ||
      /YOUR-WORKER/i.test(
        configuredUrl,
      )
    ) {
      return "";
    }

    try {
      const url =
        new URL(
          configuredUrl,
        );

      const isLocalHttp =
        url.protocol ===
          "http:" &&
        (
          url.hostname ===
            "localhost" ||
          url.hostname ===
            "127.0.0.1"
        );

      if (
        url.protocol !==
          "https:" &&
        !isLocalHttp
      ) {
        return "";
      }

      return url.href.replace(
        /\/+$/,
        "",
      );
    } catch {
      return "";
    }
  }

  function validateUpload(
    kind,
    file,
  ) {
    const allowedTypes =
      kind === "video"
        ? VIDEO_TYPES
        : POSTER_TYPES;

    const label =
      kind === "video"
        ? "Video"
        : "Poster";

    if (
      !allowedTypes.has(
        file.type,
      )
    ) {
      throw new Error(
        kind === "video"
          ? "Video must be an MP4 file."
          : "Poster must be a JPG, PNG, or WebP image.",
      );
    }

    if (file.size < 1) {
      throw new Error(
        `${label} file is empty.`,
      );
    }

    if (
      kind !== "video" &&
      file.size >
        MAX_SINGLE_UPLOAD_BYTES
    ) {
      throw new Error(
        `${label} is larger than the 95 MB single-request upload limit.`,
      );
    }

    if (
      kind === "video"
    ) {
      const partCount =
        Math.ceil(
          file.size /
          MULTIPART_CHUNK_BYTES,
        );

      if (
        partCount >
          MAX_MULTIPART_PARTS
      ) {
        throw new Error(
          "Video is too large for the multipart uploader.",
        );
      }
    }
  }

  async function parseResponseBody(
    response,
  ) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function parseSortOrder(
    value,
  ) {
    const parsed =
      Number.parseInt(
        value,
        10,
      );

    return Number.isFinite(
      parsed,
    )
      ? parsed
      : 0;
  }

  function compareFilms(
    first,
    second,
  ) {
    const orderDifference =
      Number(
        first.sort_order ||
        0,
      ) -
      Number(
        second.sort_order ||
        0,
      );

    if (orderDifference) {
      return orderDifference;
    }

    return String(
      first.created_at ||
      "",
    ).localeCompare(
      String(
        second.created_at ||
        "",
      ),
    );
  }

  function createUuid() {
    if (
      typeof crypto.randomUUID ===
      "function"
    ) {
      return crypto.randomUUID();
    }

    const bytes =
      crypto.getRandomValues(
        new Uint8Array(16),
      );

    bytes[6] =
      (bytes[6] & 0x0f) |
      0x40;

    bytes[8] =
      (bytes[8] & 0x3f) |
      0x80;

    return Array.from(
      bytes,
      (
        byte,
        index,
      ) => {
        const separator =
          [
            4,
            6,
            8,
            10,
          ].includes(index)
            ? "-"
            : "";

        return (
          `${separator}` +
          byte
            .toString(16)
            .padStart(
              2,
              "0",
            )
        );
      },
    ).join("");
  }

  function formatBytes(bytes) {
    if (
      !Number.isFinite(
        bytes,
      ) ||
      bytes < 1
    ) {
      return "0 bytes";
    }

    const units = [
      "bytes",
      "KB",
      "MB",
      "GB",
    ];

    const unitIndex =
      Math.min(
        Math.floor(
          Math.log(bytes) /
          Math.log(1024),
        ),
        units.length - 1,
      );

    const value =
      bytes /
      1024 ** unitIndex;

    return (
      `${value.toFixed(
        unitIndex === 0
          ? 0
          : 1,
      )} ${units[unitIndex]}`
    );
  }

  function capitalize(value) {
    return (
      `${value
        .charAt(0)
        .toUpperCase()}` +
      value.slice(1)
    );
  }

  function readableError(
    error,
    fallback,
  ) {
    const message =
      typeof error?.message ===
      "string"
        ? error.message.trim()
        : "";

    return (
      message ||
      fallback
    );
  }

  global.PaceAdmin =
    Object.freeze({
      initialize,
    });
})(window);
