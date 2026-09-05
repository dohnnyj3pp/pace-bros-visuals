const MEDIA_ROUTE_PREFIX = "/media/";
const ADMIN_ANALYTICS_ROUTE = "/admin/analytics";
const SOCIAL_CONNECTIONS_ROUTE = "/admin/social/connections";
const META_CONNECT_ROUTE = "/admin/social/meta/connect";
const META_COMPLETE_ROUTE = "/admin/social/meta/complete";
const META_SELECT_ROUTE = "/admin/social/meta/select";
const DEFAULT_ALLOWED_ORIGIN = "https://pacebrosvisuals.ca";
const DEFAULT_MAX_UPLOAD_BYTES = 95_000_000;
const DEFAULT_REALTIME_CACHE_SECONDS = 60;
const DEFAULT_HISTORICAL_CACHE_SECONDS = 300;
const GOOGLE_ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly";
const GOOGLE_OAUTH_TOKEN_URL =
  "https://oauth2.googleapis.com/token";
const GOOGLE_ANALYTICS_API_ORIGIN =
  "https://analyticsdata.googleapis.com";
const ANALYTICS_CACHE_ORIGIN =
  "https://pace-bros-analytics-cache.internal";
const TOP_CONTENT_LIMIT = 8;
const TRAFFIC_SOURCE_LIMIT = 8;
const DEFAULT_META_GRAPH_API_VERSION = "v26.0";
const DEFAULT_META_REDIRECT_URI =
  "https://pacebrosvisuals.ca/admin/";
const DEFAULT_META_REQUIRED_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
];
const META_INSTAGRAM_DISCOVERY_SCOPE = "instagram_basic";
const DEFAULT_META_STATE_TTL_SECONDS = 600;
const META_GRAPH_ORIGIN = "https://graph.facebook.com";
const META_DIALOG_ORIGIN = "https://www.facebook.com";
const META_SELECTION_PURPOSE = "meta-page-selection";
const META_STATE_PURPOSE = "meta-oauth";
const META_SELECTION_AAD = "pace-bros:meta-page-selection:v1";
const MAX_SOCIAL_REQUEST_BYTES = 128_000;
const MAX_META_PAGES = 100;
const SOCIAL_CONNECTION_COLUMNS = [
  "id",
  "provider",
  "platform",
  "external_account_id",
  "display_name",
  "username",
  "token_expires_at",
  "scopes",
  "status",
  "metadata",
  "created_by",
  "connected_at",
  "created_at",
  "updated_at",
].join(",");

let googleAccessTokenCache = null;
let googleAccessTokenInFlight = null;
const analyticsMemoryCache = new Map();
const analyticsPartRequestsInFlight = new Map();

const ALLOWED_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "OPTIONS",
]);

const ALLOWED_REQUEST_HEADERS = new Set([
  "authorization",
  "content-type",
  "range",
  "x-film-id",
]);

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const FILM_ID_PATTERN = new RegExp(`^${UUID_PATTERN}$`, "i");

const MEDIA_KEY_PATTERN = new RegExp(
  `^films/${UUID_PATTERN}/(?:video/${UUID_PATTERN}\\.mp4|poster/${UUID_PATTERN}\\.(?:jpg|png|webp)|clips/${UUID_PATTERN}\\.mp4)$`,
  "i",
);

const VIDEO_KEY_PATTERN = new RegExp(
  `^films/${UUID_PATTERN}/video/${UUID_PATTERN}\\.mp4$`,
  "i",
);

const UPLOAD_TYPES = new Map([
  [
    "/upload/video",
    {
      kind: "video",
      mimeTypes: new Map([
        ["video/mp4", { extension: "mp4", contentType: "video/mp4" }],
      ]),
    },
  ],
  [
    "/upload/poster",
    {
      kind: "poster",
      mimeTypes: new Map([
        ["image/jpeg", { extension: "jpg", contentType: "image/jpeg" }],
        ["image/jpg", { extension: "jpg", contentType: "image/jpeg" }],
        ["image/png", { extension: "png", contentType: "image/png" }],
        ["image/webp", { extension: "webp", contentType: "image/webp" }],
      ]),
    },
  ],
  [
    "/upload/clip",
    {
      kind: "clip",
      pathSegment: "clips",
      mimeTypes: new Map([
        ["video/mp4", { extension: "mp4", contentType: "video/mp4" }],
      ]),
    },
  ],
]);

class HttpError extends Error {
  constructor(status, code, message, headers = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export default {
  async fetch(request, env, executionContext) {
    let response;

    try {
      response = await routeRequest(
        request,
        env,
        executionContext,
      );
    } catch (error) {
      if (error instanceof HttpError) {
        response = errorResponse(
          error.status,
          error.code,
          error.message,
          error.headers,
        );
      } else {
        console.error("Unhandled Pace Bros media Worker error", error);
        response = errorResponse(
          500,
          "internal_error",
          "The media service could not complete the request.",
        );
      }
    }

    return applyCors(response, request, env);
  },
};

async function routeRequest(
  request,
  env,
  executionContext,
) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return handlePreflight(request, env);
  }

  if (url.pathname === ADMIN_ANALYTICS_ROUTE) {
    if (request.method !== "GET") {
      throw new HttpError(
        405,
        "method_not_allowed",
        "This analytics route only accepts GET requests.",
        { Allow: "GET, OPTIONS" },
      );
    }

    return handleAdminAnalytics(
      request,
      env,
      executionContext,
    );
  }

  const socialResponse = await routeSocialAdminRequest(
    request,
    env,
    url,
  );

  if (socialResponse) {
    return socialResponse;
  }

  if (url.pathname === "/upload/video/multipart/create") {
    if (request.method !== "POST") {
      throw new HttpError(
        405,
        "method_not_allowed",
        "This multipart route only accepts POST requests.",
        { Allow: "POST, OPTIONS" },
      );
    }

    return createVideoMultipartUpload(request, env);
  }

  if (url.pathname === "/upload/video/multipart/part") {
    if (request.method !== "PUT") {
      throw new HttpError(
        405,
        "method_not_allowed",
        "This multipart route only accepts PUT requests.",
        { Allow: "PUT, OPTIONS" },
      );
    }

    return uploadVideoMultipartPart(request, env, url);
  }

  if (url.pathname === "/upload/video/multipart/complete") {
    if (request.method !== "POST") {
      throw new HttpError(
        405,
        "method_not_allowed",
        "This multipart route only accepts POST requests.",
        { Allow: "POST, OPTIONS" },
      );
    }

    return completeVideoMultipartUpload(request, env, url);
  }

  if (url.pathname === "/upload/video/multipart/abort") {
    if (request.method !== "DELETE") {
      throw new HttpError(
        405,
        "method_not_allowed",
        "This multipart route only accepts DELETE requests.",
        { Allow: "DELETE, OPTIONS" },
      );
    }

    return abortVideoMultipartUpload(request, env, url);
  }

  const uploadType = UPLOAD_TYPES.get(url.pathname);

  if (uploadType) {
    if (request.method !== "POST") {
      throw new HttpError(
        405,
        "method_not_allowed",
        "This upload route only accepts POST requests.",
        { Allow: "POST, OPTIONS" },
      );
    }

    return handleUpload(request, env, uploadType);
  }

  if (url.pathname.startsWith(MEDIA_ROUTE_PREFIX)) {
    const objectKey = readObjectKey(url.pathname);

    if (request.method === "GET" || request.method === "HEAD") {
      return serveMedia(request, env, objectKey);
    }

    if (request.method === "DELETE") {
      return deleteMedia(request, env, objectKey);
    }

    throw new HttpError(
      405,
      "method_not_allowed",
      "This media route does not accept that method.",
      { Allow: "GET, HEAD, DELETE, OPTIONS" },
    );
  }

  throw new HttpError(404, "not_found", "Route not found.");
}

function handlePreflight(request, env) {
  const origin = request.headers.get("Origin");

  if (!origin || !getAllowedOrigins(env).has(origin)) {
    throw new HttpError(
      403,
      "origin_not_allowed",
      "This origin is not allowed.",
    );
  }

  const requestedMethod = request.headers
    .get("Access-Control-Request-Method")
    ?.toUpperCase();

  if (requestedMethod && !ALLOWED_METHODS.has(requestedMethod)) {
    throw new HttpError(
      405,
      "method_not_allowed",
      "The requested method is not allowed.",
    );
  }

  const requestedHeaders =
    request.headers
      .get("Access-Control-Request-Headers")
      ?.split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean) ?? [];

  if (
    requestedHeaders.some(
      (header) => !ALLOWED_REQUEST_HEADERS.has(header),
    )
  ) {
    throw new HttpError(
      403,
      "headers_not_allowed",
      "One or more requested headers are not allowed.",
    );
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, Range, X-Film-Id",
      "Access-Control-Allow-Methods":
        "GET, HEAD, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function createVideoMultipartUpload(request, env) {
  assertBucketBinding(env);
  assertAdminRequestOrigin(request, env);

  const { userId } = await authorizeAdmin(request, env);
  const filmId = readFilmId(request);

  const objectId = crypto.randomUUID();
  const objectKey = `films/${filmId}/video/${objectId}.mp4`;

  let multipartUpload;

  try {
    multipartUpload = await env.MEDIA_BUCKET.createMultipartUpload(
      objectKey,
      {
        httpMetadata: {
          contentType: "video/mp4",
          cacheControl: "public, max-age=31536000, immutable",
        },
        customMetadata: {
          filmId,
          mediaKind: "video",
          uploadedBy: userId,
        },
      },
    );
  } catch (error) {
    console.error("Unable to create multipart upload", error);

    throw new HttpError(
      502,
      "multipart_create_failed",
      "The video multipart upload could not be started.",
    );
  }

  return jsonResponse(
    {
      key: objectKey,
      uploadId: multipartUpload.uploadId,
    },
    { status: 201 },
  );
}

async function uploadVideoMultipartPart(request, env, url) {
  assertBucketBinding(env);
  assertAdminRequestOrigin(request, env);
  await authorizeAdmin(request, env);

  const { key, uploadId } = readMultipartIdentity(url);
  const partNumber = readPartNumber(url);

  if (!request.body) {
    throw new HttpError(
      400,
      "empty_upload",
      "The multipart upload part is empty.",
    );
  }

  const declaredSize = readDeclaredSize(request);
  const maxUploadBytes = getMaxUploadBytes(env);

  if (declaredSize !== null && declaredSize > maxUploadBytes) {
    throw uploadTooLarge(maxUploadBytes);
  }

  if (declaredSize === 0) {
    throw new HttpError(
      400,
      "empty_upload",
      "The multipart upload part is empty.",
    );
  }

  const multipartUpload =
    env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);

  try {
    const uploadedPart = await multipartUpload.uploadPart(
      partNumber,
      request.body,
    );

    return jsonResponse({
      partNumber: uploadedPart.partNumber,
      etag: uploadedPart.etag,
    });
  } catch (error) {
    console.error("Multipart part upload failed", error);

    throw new HttpError(
      400,
      "multipart_part_failed",
      `Video part ${partNumber} could not be uploaded.`,
    );
  }
}

async function completeVideoMultipartUpload(request, env, url) {
  assertBucketBinding(env);
  assertAdminRequestOrigin(request, env);
  await authorizeAdmin(request, env);

  const { key, uploadId } = readMultipartIdentity(url);

  let payload;

  try {
    payload = await request.json();
  } catch {
    throw new HttpError(
      400,
      "invalid_multipart_parts",
      "Multipart completion requires a JSON parts list.",
    );
  }

  const parts = validateUploadedParts(payload?.parts);
  const multipartUpload =
    env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);

  let completedObject;

  try {
    completedObject = await multipartUpload.complete(parts);
  } catch (error) {
    console.error("Multipart completion failed", error);

    throw new HttpError(
      400,
      "multipart_complete_failed",
      "The multipart video upload could not be completed.",
    );
  }

  return jsonResponse({
    key: completedObject.key,
    size: completedObject.size,
    etag: completedObject.etag,
    contentType: "video/mp4",
  });
}

async function abortVideoMultipartUpload(request, env, url) {
  assertBucketBinding(env);
  assertAdminRequestOrigin(request, env);
  await authorizeAdmin(request, env);

  const { key, uploadId } = readMultipartIdentity(url);
  const multipartUpload =
    env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);

  try {
    await multipartUpload.abort();
  } catch (error) {
    console.error("Multipart abort failed", error);

    throw new HttpError(
      400,
      "multipart_abort_failed",
      "The multipart video upload could not be aborted.",
    );
  }

  return new Response(null, { status: 204 });
}

async function handleUpload(request, env, uploadType) {
  assertBucketBinding(env);
  assertAdminRequestOrigin(request, env);

  const { userId } = await authorizeAdmin(request, env);
  const filmId = readFilmId(request);

  const suppliedContentType = normalizeContentType(
    request.headers.get("Content-Type"),
  );

  const mediaType =
    uploadType.mimeTypes.get(suppliedContentType);

  if (!mediaType) {
    const expected =
      uploadType.kind === "poster"
        ? "a JPG, PNG, or WebP image"
        : "an MP4 video";

    throw new HttpError(
      415,
      "unsupported_media_type",
      `Upload ${expected} with its correct Content-Type.`,
    );
  }

  if (!request.body) {
    throw new HttpError(
      400,
      "empty_upload",
      "The upload body is empty.",
    );
  }

  const maxUploadBytes = getMaxUploadBytes(env);
  const declaredSize = readDeclaredSize(request);

  if (
    declaredSize !== null &&
    declaredSize > maxUploadBytes
  ) {
    throw uploadTooLarge(maxUploadBytes);
  }

  if (declaredSize === 0) {
    throw new HttpError(
      400,
      "empty_upload",
      "The upload body is empty.",
    );
  }

  const objectId = crypto.randomUUID();
  const pathSegment =
    uploadType.pathSegment ?? uploadType.kind;

  const objectKey =
    `films/${filmId}/${pathSegment}/` +
    `${objectId}.${mediaType.extension}`;

  const storedObject = await env.MEDIA_BUCKET.put(
    objectKey,
    request.body,
    {
      httpMetadata: {
        contentType: mediaType.contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        filmId,
        mediaKind: uploadType.kind,
        uploadedBy: userId,
      },
    },
  );

  if (storedObject.size === 0) {
    await env.MEDIA_BUCKET.delete(objectKey);

    throw new HttpError(
      400,
      "empty_upload",
      "The upload body is empty.",
    );
  }

  if (storedObject.size > maxUploadBytes) {
    await env.MEDIA_BUCKET.delete(objectKey);
    throw uploadTooLarge(maxUploadBytes);
  }

  return jsonResponse(
    {
      key: objectKey,
      contentType: mediaType.contentType,
      size: storedObject.size,
      etag: storedObject.etag,
    },
    { status: 201 },
  );
}

async function deleteMedia(request, env, objectKey) {
  assertBucketBinding(env);
  assertAdminRequestOrigin(request, env);
  await authorizeAdmin(request, env);

  await env.MEDIA_BUCKET.delete(objectKey);

  return new Response(null, { status: 204 });
}

async function serveMedia(request, env, objectKey) {
  assertBucketBinding(env);

  if (request.method === "HEAD") {
    const object = await env.MEDIA_BUCKET.head(objectKey);

    if (!object) {
      throw new HttpError(
        404,
        "media_not_found",
        "Media not found.",
      );
    }

    const headers = mediaHeaders(object);

    return new Response(null, {
      status: 200,
      headers,
    });
  }

  const rangeHeader = request.headers.get("Range");

  if (!rangeHeader) {
    const object = await env.MEDIA_BUCKET.get(objectKey);

    if (!object) {
      throw new HttpError(
        404,
        "media_not_found",
        "Media not found.",
      );
    }

    const headers = mediaHeaders(object);

    return new Response(
      fixedLengthBody(object.body, object.size),
      {
        status: 200,
        headers,
      },
    );
  }

  const metadata = await env.MEDIA_BUCKET.head(objectKey);

  if (!metadata) {
    throw new HttpError(
      404,
      "media_not_found",
      "Media not found.",
    );
  }

  const range = parseSingleRange(
    rangeHeader,
    metadata.size,
  );

  if (!range) {
    throw new HttpError(
      416,
      "invalid_range",
      "The requested byte range cannot be served.",
      {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${metadata.size}`,
      },
    );
  }

  const object = await env.MEDIA_BUCKET.get(objectKey, {
    range: {
      offset: range.offset,
      length: range.length,
    },
  });

  if (!object) {
    throw new HttpError(
      404,
      "media_not_found",
      "Media not found.",
    );
  }

  const headers = mediaHeaders(object);

  headers.set(
    "Content-Range",
    `bytes ${range.offset}-${range.end}/${metadata.size}`,
  );

  return new Response(
    fixedLengthBody(object.body, range.length),
    {
      status: 206,
      headers,
    },
  );
}

async function routeSocialAdminRequest(request, env, url) {
  if (url.pathname === META_CONNECT_ROUTE) {
    assertRequestMethod(request, "POST", "POST, OPTIONS");
    return handleMetaConnect(request, env);
  }

  if (url.pathname === META_COMPLETE_ROUTE) {
    assertRequestMethod(request, "POST", "POST, OPTIONS");
    return handleMetaComplete(request, env);
  }

  if (url.pathname === META_SELECT_ROUTE) {
    assertRequestMethod(request, "POST", "POST, OPTIONS");
    return handleMetaPageSelection(request, env);
  }

  if (url.pathname === SOCIAL_CONNECTIONS_ROUTE) {
    assertRequestMethod(request, "GET", "GET, OPTIONS");
    return handleSocialConnectionsList(request, env);
  }

  const connectionPrefix = `${SOCIAL_CONNECTIONS_ROUTE}/`;

  if (url.pathname.startsWith(connectionPrefix)) {
    assertRequestMethod(request, "DELETE", "DELETE, OPTIONS");
    const connectionId = url.pathname.slice(connectionPrefix.length);

    if (!FILM_ID_PATTERN.test(connectionId)) {
      throw new HttpError(
        400,
        "invalid_social_connection_id",
        "The social connection ID is invalid.",
      );
    }

    return handleSocialConnectionDelete(
      request,
      env,
      connectionId.toLowerCase(),
    );
  }

  return null;
}

function assertRequestMethod(request, method, allow) {
  if (request.method === method) return;

  throw new HttpError(
    405,
    "method_not_allowed",
    "This social account route does not accept that method.",
    { Allow: allow },
  );
}

async function handleMetaConnect(request, env) {
  assertAdminRequestOrigin(request, env);
  const { userId } = await authorizeAdmin(request, env);
  const configuration = readMetaConfiguration(env);
  const body = await readSocialJsonBody(request, { optional: true });
  const replaceConnectionId = readOptionalConnectionId(
    body.connectionId,
  );
  const issuedAt = Math.floor(Date.now() / 1000);
  const state = await createMetaOAuthState(
    {
      version: 1,
      purpose: META_STATE_PURPOSE,
      subject: userId,
      nonce: encodeBase64UrlBytes(
        crypto.getRandomValues(new Uint8Array(24)),
      ),
      issuedAt,
      expiresAt:
        issuedAt + configuration.stateTtlSeconds,
      replaceConnectionId,
    },
    configuration.stateSecret,
  );

  const authorizationUrl = new URL(
    `/${configuration.graphApiVersion}/dialog/oauth`,
    META_DIALOG_ORIGIN,
  );
  authorizationUrl.searchParams.set("client_id", configuration.appId);
  authorizationUrl.searchParams.set("redirect_uri", configuration.redirectUri);
  authorizationUrl.searchParams.set("config_id", configuration.loginConfigId);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("override_default_response_type", "true");
  authorizationUrl.searchParams.set("auth_type", "rerequest");
  authorizationUrl.searchParams.set("state", state);

  return jsonResponse(
    {
      authorizationUrl: authorizationUrl.href,
      expiresIn: configuration.stateTtlSeconds,
    },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

async function handleMetaComplete(request, env) {
  assertAdminRequestOrigin(request, env);
  const { userId, accessToken } = await authorizeAdmin(request, env);
  const configuration = readMetaConfiguration(env);
  const body = await readSocialJsonBody(request);
  const code = readBoundedString(body.code, "authorization code", 4096);
  const state = readBoundedString(body.state, "OAuth state", 8192);
  const statePayload = await verifyMetaOAuthState(
    state,
    configuration,
    userId,
  );
  const authorization = await completeMetaAuthorization(
    code,
    configuration,
  );

  if (authorization.pages.length === 1) {
    const connection = await createAndPersistMetaConnection({
      page: authorization.pages[0],
      authorization,
      configuration,
      supabaseAccessToken: accessToken,
      userId,
      replaceConnectionId: statePayload.replaceConnectionId,
      env,
    });

    return jsonResponse(
      { connection },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const selectionToken = await createMetaSelectionToken(
    {
      version: 1,
      purpose: META_SELECTION_PURPOSE,
      subject: userId,
      expiresAt:
        Math.floor(Date.now() / 1000) +
        configuration.stateTtlSeconds,
      replaceConnectionId: statePayload.replaceConnectionId,
      tokenExpiresAt: authorization.tokenExpiresAt,
      scopes: authorization.scopes,
      pages: authorization.pages,
    },
    configuration.encryptionKey,
  );

  return jsonResponse(
    {
      selectionRequired: true,
      selectionToken,
      pages: authorization.pages.map(sanitizeMetaPageOption),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

async function handleMetaPageSelection(request, env) {
  assertAdminRequestOrigin(request, env);
  const { userId, accessToken } = await authorizeAdmin(request, env);
  const configuration = readMetaConfiguration(env);
  const body = await readSocialJsonBody(request);
  const selectionToken = readBoundedString(
    body.selectionToken,
    "Page selection token",
    120_000,
  );
  const pageId = readMetaObjectId(body.pageId, "Facebook Page ID");
  const selection = await readMetaSelectionToken(
    selectionToken,
    configuration.encryptionKey,
    userId,
  );
  const page = selection.pages.find((candidate) => candidate.id === pageId);

  if (!page) {
    throw new HttpError(
      400,
      "invalid_meta_page_selection",
      "Select one of the Facebook Pages returned by this connection attempt.",
    );
  }

  const connection = await createAndPersistMetaConnection({
    page,
    authorization: {
      tokenExpiresAt: selection.tokenExpiresAt,
      scopes: selection.scopes,
    },
    configuration,
    supabaseAccessToken: accessToken,
    userId,
    replaceConnectionId: selection.replaceConnectionId,
    env,
  });

  return jsonResponse(
    { connection },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

async function handleSocialConnectionsList(request, env) {
  assertAdminRequestOrigin(request, env);
  const { accessToken } = await authorizeAdmin(request, env);
  const rows = await listSocialConnectionRows(env, accessToken);

  return jsonResponse(
    { connections: rows.map(sanitizeSocialConnection) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

async function handleSocialConnectionDelete(
  request,
  env,
  connectionId,
) {
  assertAdminRequestOrigin(request, env);
  const { accessToken } = await authorizeAdmin(request, env);
  const deleted = await deleteSocialConnectionRow(
    env,
    accessToken,
    connectionId,
  );

  if (!deleted) {
    throw new HttpError(
      404,
      "social_connection_not_found",
      "That social connection no longer exists.",
    );
  }

  return jsonResponse(
    { disconnected: true, id: connectionId },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

function readMetaConfiguration(env) {
  const appId = String(env.META_APP_ID ?? "").trim();
  const appSecret = String(env.META_APP_SECRET ?? "").trim();
  const loginConfigId = String(env.META_LOGIN_CONFIG_ID ?? "").trim();
  const stateSecret = String(env.META_OAUTH_STATE_SECRET ?? "").trim();
  const encryptionKey = String(
    env.META_TOKEN_ENCRYPTION_KEY ?? "",
  ).trim();
  const graphApiVersion = String(
    env.META_GRAPH_API_VERSION ?? DEFAULT_META_GRAPH_API_VERSION,
  ).trim();
  const redirectUri = String(
    env.META_REDIRECT_URI ?? DEFAULT_META_REDIRECT_URI,
  ).trim();
  const stateTtlSeconds = Number(
    env.META_OAUTH_STATE_TTL_SECONDS ??
      DEFAULT_META_STATE_TTL_SECONDS,
  );

  let parsedRedirectUri;

  try {
    parsedRedirectUri = new URL(redirectUri);
  } catch {
    throw metaNotConfigured();
  }

  const stateSecretBytes = new TextEncoder().encode(stateSecret);
  const encryptionKeyBytes = decodeBase64Secret(encryptionKey);

  if (
    !/^\d{5,32}$/.test(appId) ||
    !/^\d{5,32}$/.test(loginConfigId) ||
    appSecret.length < 8 ||
    stateSecretBytes.byteLength < 32 ||
    encryptionKeyBytes?.byteLength !== 32 ||
    !/^v\d+\.\d+$/.test(graphApiVersion) ||
    parsedRedirectUri.protocol !== "https:" ||
    parsedRedirectUri.search ||
    parsedRedirectUri.hash ||
    !getAllowedOrigins(env).has(parsedRedirectUri.origin) ||
    !Number.isSafeInteger(stateTtlSeconds) ||
    stateTtlSeconds < 300 ||
    stateTtlSeconds > 1800
  ) {
    throw metaNotConfigured();
  }

  return {
    appId,
    appSecret,
    loginConfigId,
    stateSecret,
    encryptionKey,
    graphApiVersion,
    redirectUri: parsedRedirectUri.href,
    stateTtlSeconds,
    requiredScopes: readMetaRequiredScopes(env),
  };
}

function readMetaRequiredScopes(env) {
  const configured = String(env.META_REQUIRED_SCOPES ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const scopes = configured.length
    ? configured
    : DEFAULT_META_REQUIRED_SCOPES;

  if (
    scopes.length > 20 ||
    scopes.some((scope) => !/^[a-z][a-z0-9_]{1,80}$/.test(scope))
  ) {
    throw metaNotConfigured();
  }

  return Array.from(new Set(scopes));
}

function metaNotConfigured() {
  return new HttpError(
    503,
    "meta_not_configured",
    "Meta account connection is not configured for this service.",
  );
}

async function completeMetaAuthorization(code, configuration) {
  const shortLived = await requestMetaToken(
    configuration,
    {
      client_id: configuration.appId,
      client_secret: configuration.appSecret,
      redirect_uri: configuration.redirectUri,
      code,
    },
    "authorization_code_exchange",
  );
  const shortToken = readMetaAccessToken(shortLived);
  const longLived = await requestMetaToken(
    configuration,
    {
      grant_type: "fb_exchange_token",
      client_id: configuration.appId,
      client_secret: configuration.appSecret,
      fb_exchange_token: shortToken,
    },
    "long_lived_token_exchange",
  );
  const userAccessToken = readMetaAccessToken(longLived);
  const tokenExpiresAt = expiryFromSeconds(
    longLived.expires_in ?? shortLived.expires_in,
  );
  const scopes = await getGrantedMetaScopes(
    configuration,
    userAccessToken,
  );
  const missingScopes = configuration.requiredScopes.filter(
    (scope) => !scopes.includes(scope),
  );

  if (missingScopes.length) {
    throw new HttpError(
      422,
      "meta_permissions_missing",
      `Meta did not grant these required permissions: ${missingScopes.join(", ")}. Reconnect and approve the complete permission set.`,
    );
  }

  const pages = await discoverManagedMetaPages(
    configuration,
    userAccessToken,
    scopes,
  );

  return {
    userAccessToken,
    tokenExpiresAt,
    scopes,
    pages,
  };
}

async function requestMetaToken(
  configuration,
  parameters,
  operation,
) {
  const url = new URL(
    `/${configuration.graphApiVersion}/oauth/access_token`,
    META_GRAPH_ORIGIN,
  );
  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams(parameters),
    });
  } catch {
    throw new HttpError(
      502,
      "meta_token_exchange_failed",
      "Meta could not complete the authorization exchange. Try connecting again.",
    );
  }

  const payload = await parseMetaResponse(response);

  if (!response.ok || payload?.error || !payload?.access_token) {
    console.warn("Meta OAuth exchange failed", {
      operation,
      httpStatus: response.status,
      metaCode: readMetaErrorCode(payload),
    });

    throw new HttpError(
      502,
      "meta_token_exchange_failed",
      "Meta could not complete the authorization exchange. Try connecting again.",
    );
  }

  return payload;
}

function readMetaAccessToken(payload) {
  const token = typeof payload?.access_token === "string"
    ? payload.access_token.trim()
    : "";

  if (!token || token.length > 16_384) {
    throw new HttpError(
      502,
      "meta_token_exchange_failed",
      "Meta returned an unusable authorization response. Try connecting again.",
    );
  }

  return token;
}

function expiryFromSeconds(value) {
  const seconds = Number(value);

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 366 * 24 * 60 * 60
  ) {
    return null;
  }

  return new Date(Date.now() + Math.floor(seconds) * 1000).toISOString();
}

async function getGrantedMetaScopes(configuration, accessToken) {
  const payload = await requestMetaGraph(
    configuration,
    "me/permissions",
    accessToken,
    { limit: "100" },
    "permissions",
  );

  return Array.from(
    new Set(
      (Array.isArray(payload?.data) ? payload.data : [])
        .filter((entry) => entry?.status === "granted")
        .map((entry) => String(entry?.permission ?? "").trim())
        .filter((scope) => /^[a-z][a-z0-9_]{1,80}$/.test(scope)),
    ),
  ).sort();
}

async function discoverManagedMetaPages(
  configuration,
  userAccessToken,
  scopes,
) {
  const canDiscoverInstagram = scopes.includes(
    META_INSTAGRAM_DISCOVERY_SCOPE,
  );
  const fields = canDiscoverInstagram
    ? "id,name,access_token,tasks,instagram_business_account"
    : "id,name,access_token,tasks";
  const payload = await requestMetaGraph(
    configuration,
    "me/accounts",
    userAccessToken,
    {
      fields,
      limit: String(MAX_META_PAGES),
    },
    "page_discovery",
  );
  const candidates = Array.isArray(payload?.data) ? payload.data : [];
  const pages = candidates
    .slice(0, MAX_META_PAGES)
    .map(normalizeManagedMetaPage)
    .filter(Boolean);

  if (!pages.length) {
    throw new HttpError(
      422,
      "meta_no_managed_pages",
      "Meta did not return a manageable Facebook Page. Confirm the Facebook identity has Page access and reconnect.",
    );
  }

  return pages;
}

function normalizeManagedMetaPage(page) {
  const id = normalizeMetaObjectId(page?.id);
  const name = sanitizeSocialText(page?.name, 240);
  const pageAccessToken = typeof page?.access_token === "string"
    ? page.access_token.trim()
    : "";
  const instagramAccountId = normalizeMetaObjectId(
    page?.instagram_business_account?.id,
  );

  if (!id || !name || !pageAccessToken || pageAccessToken.length > 16_384) {
    return null;
  }

  return {
    id,
    name,
    pageAccessToken,
    tasks: Array.from(
      new Set(
        (Array.isArray(page?.tasks) ? page.tasks : [])
          .map((task) => sanitizeSocialText(task, 100))
          .filter(Boolean),
      ),
    ).slice(0, 32),
    instagramAccountId,
  };
}

async function requestMetaGraph(
  configuration,
  path,
  accessToken,
  parameters,
  operation,
) {
  const url = new URL(
    `/${configuration.graphApiVersion}/${path}`,
    META_GRAPH_ORIGIN,
  );

  for (const [name, value] of Object.entries(parameters ?? {})) {
    url.searchParams.set(name, value);
  }

  url.searchParams.set(
    "appsecret_proof",
    await createMetaAppSecretProof(
      accessToken,
      configuration.appSecret,
    ),
  );

  let response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new HttpError(
      502,
      "meta_api_unavailable",
      "Meta account information is temporarily unavailable.",
    );
  }

  const payload = await parseMetaResponse(response);

  if (!response.ok || payload?.error) {
    console.warn("Meta Graph request failed", {
      operation,
      httpStatus: response.status,
      metaCode: readMetaErrorCode(payload),
    });

    throw new HttpError(
      502,
      "meta_api_unavailable",
      "Meta account information is temporarily unavailable.",
    );
  }

  return payload;
}

async function createMetaAppSecretProof(accessToken, appSecret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(accessToken),
    ),
  );

  return Array.from(signature, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function parseMetaResponse(response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const parameters = new URLSearchParams(text);
    return Object.fromEntries(parameters.entries());
  }
}

function readMetaErrorCode(payload) {
  const value = payload?.error?.code ?? payload?.error_code ?? "unknown";
  return sanitizeSocialText(value, 40) || "unknown";
}

async function createAndPersistMetaConnection({
  page,
  authorization,
  configuration,
  supabaseAccessToken,
  userId,
  replaceConnectionId,
  env,
}) {
  const instagramDiscovery = await discoverLinkedInstagramAccount(
    page,
    configuration,
    authorization.scopes,
  );
  const connectedAt = new Date().toISOString();
  const encryptedCredentials = await encryptMetaPayload(
    {
      version: 1,
      provider: "meta",
      graphApiVersion: configuration.graphApiVersion,
      facebookPageAccessToken: page.pageAccessToken,
      facebookPageId: page.id,
      instagramAccountId: instagramDiscovery.account?.id ?? null,
      scopes: authorization.scopes,
      tokenExpiresAt: authorization.tokenExpiresAt,
      storedAt: connectedAt,
    },
    configuration.encryptionKey,
    metaCredentialsAad(page.id),
  );
  const row = {
    provider: "meta",
    platform: "facebook",
    external_account_id: page.id,
    display_name: page.name,
    username: null,
    encrypted_credentials: encryptedCredentials,
    token_expires_at: authorization.tokenExpiresAt,
    scopes: authorization.scopes,
    status: "connected",
    metadata: {
      graphApiVersion: configuration.graphApiVersion,
      facebook: {
        id: page.id,
        name: page.name,
        tasks: page.tasks,
      },
      instagram: instagramDiscovery.account,
      instagramDiscovery: instagramDiscovery.status,
    },
    created_by: userId,
    connected_at: connectedAt,
  };
  const saved = await persistSocialConnectionRow(
    env,
    supabaseAccessToken,
    row,
  );

  if (replaceConnectionId && replaceConnectionId !== saved.id) {
    const removed = await deleteSocialConnectionRow(
      env,
      supabaseAccessToken,
      replaceConnectionId,
    );

    if (!removed) {
      console.warn("Meta reconnect left the prior connection unchanged", {
        replacementStatus: "not_found",
      });
    }
  }

  return sanitizeSocialConnection(saved);
}

async function discoverLinkedInstagramAccount(
  page,
  configuration,
  scopes,
) {
  if (!scopes.includes(META_INSTAGRAM_DISCOVERY_SCOPE)) {
    return { account: null, status: "unavailable" };
  }

  if (!page.instagramAccountId) {
    return { account: null, status: "not_linked" };
  }

  try {
    const payload = await requestMetaGraph(
      configuration,
      page.instagramAccountId,
      page.pageAccessToken,
      { fields: "id,username,name" },
      "instagram_discovery",
    );
    const id = normalizeMetaObjectId(payload?.id) ?? page.instagramAccountId;
    const username = sanitizeSocialText(payload?.username, 160) || null;
    const name = sanitizeSocialText(payload?.name, 240) || null;

    return {
      account: { id, username, name },
      status: "connected",
    };
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;

    return {
      account: {
        id: page.instagramAccountId,
        username: null,
        name: null,
      },
      status: "unavailable",
    };
  }
}

function sanitizeMetaPageOption(page) {
  return {
    id: page.id,
    name: page.name,
    instagram: page.instagramAccountId
      ? { id: page.instagramAccountId }
      : null,
  };
}

function sanitizeSocialConnection(row) {
  const metadata = isPlainObject(row?.metadata) ? row.metadata : {};
  const facebook = isPlainObject(metadata.facebook)
    ? metadata.facebook
    : {};
  const instagram = isPlainObject(metadata.instagram)
    ? metadata.instagram
    : null;
  const expiresAt = normalizeIsoTimestamp(row?.token_expires_at);
  const storedStatus = row?.status === "reconnect_required"
    ? "reconnect_required"
    : "connected";
  const status = expiresAt && Date.parse(expiresAt) <= Date.now()
    ? "reconnect_required"
    : storedStatus;
  const externalAccountId = sanitizeSocialText(
    row?.external_account_id,
    128,
  );
  const displayName = sanitizeSocialText(row?.display_name, 240);

  return {
    id: String(row?.id ?? ""),
    provider: sanitizeSocialText(row?.provider, 64),
    platform: sanitizeSocialText(row?.platform, 64),
    externalAccountId,
    displayName,
    username: sanitizeSocialText(row?.username, 160) || null,
    status,
    tokenExpiresAt: expiresAt,
    scopes: normalizeScopeList(row?.scopes),
    connectedAt: normalizeIsoTimestamp(row?.connected_at),
    createdAt: normalizeIsoTimestamp(row?.created_at),
    updatedAt: normalizeIsoTimestamp(row?.updated_at),
    facebook: {
      id: normalizeMetaObjectId(facebook.id) ?? externalAccountId,
      name: sanitizeSocialText(facebook.name, 240) || displayName,
    },
    instagram: instagram
      ? {
          id: normalizeMetaObjectId(instagram.id),
          username: sanitizeSocialText(instagram.username, 160) || null,
          name: sanitizeSocialText(instagram.name, 240) || null,
        }
      : null,
    instagramDiscovery:
      ["connected", "not_linked", "unavailable"].includes(
        metadata.instagramDiscovery,
      )
        ? metadata.instagramDiscovery
        : instagram
          ? "connected"
          : "not_linked",
  };
}

async function listSocialConnectionRows(env, accessToken) {
  const url = socialConnectionsRestUrl(env);
  url.searchParams.set("select", SOCIAL_CONNECTION_COLUMNS);
  url.searchParams.set("order", "connected_at.desc,id.asc");
  const response = await fetchSocialStorage(
    url,
    env,
    accessToken,
    { method: "GET" },
  );
  const rows = await parseJson(response);

  if (!response.ok || !Array.isArray(rows)) {
    throw socialStorageUnavailable(response.status);
  }

  return rows;
}

async function persistSocialConnectionRow(env, accessToken, row) {
  const url = socialConnectionsRestUrl(env);
  url.searchParams.set(
    "on_conflict",
    "provider,platform,external_account_id",
  );
  url.searchParams.set("select", SOCIAL_CONNECTION_COLUMNS);
  const response = await fetchSocialStorage(
    url,
    env,
    accessToken,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    },
  );
  const rows = await parseJson(response);

  if (!response.ok || !Array.isArray(rows) || !rows[0]?.id) {
    throw socialStorageUnavailable(response.status);
  }

  return rows[0];
}

async function deleteSocialConnectionRow(env, accessToken, connectionId) {
  const url = socialConnectionsRestUrl(env);
  url.searchParams.set("id", `eq.${connectionId}`);
  url.searchParams.set("select", "id");
  const response = await fetchSocialStorage(
    url,
    env,
    accessToken,
    {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    },
  );
  const rows = await parseJson(response);

  if (!response.ok || !Array.isArray(rows)) {
    throw socialStorageUnavailable(response.status);
  }

  return rows.some((row) => row?.id === connectionId);
}

function socialConnectionsRestUrl(env) {
  return new URL(
    "/rest/v1/social_connections",
    readSupabaseUrl(env),
  );
}

async function fetchSocialStorage(
  url,
  env,
  accessToken,
  init,
) {
  const publishableKey = String(
    env.SUPABASE_PUBLISHABLE_KEY ?? "",
  ).trim();

  if (!publishableKey) {
    throw new HttpError(
      500,
      "worker_not_configured",
      "The media service is missing its Supabase configuration.",
    );
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("apikey", publishableKey);
  headers.set("Authorization", `Bearer ${accessToken}`);

  try {
    return await fetch(url, { ...init, headers });
  } catch {
    throw socialStorageUnavailable(0);
  }
}

function socialStorageUnavailable(httpStatus) {
  console.warn("Social connection storage request failed", { httpStatus });

  return new HttpError(
    502,
    "social_storage_unavailable",
    "Social connections are temporarily unavailable. Confirm the social connections migration has been applied.",
  );
}

async function readSocialJsonBody(request, { optional = false } = {}) {
  const contentType = normalizeContentType(
    request.headers.get("Content-Type"),
  );

  if (contentType && contentType !== "application/json") {
    throw new HttpError(
      415,
      "invalid_social_request",
      "Social account requests must use application/json.",
    );
  }

  const declaredLength = request.headers.get("Content-Length");

  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const byteLength = Number(declaredLength);

    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength > MAX_SOCIAL_REQUEST_BYTES
    ) {
      throw new HttpError(
        413,
        "social_request_too_large",
        "The social account request is too large.",
      );
    }
  }

  const text = await request.text();

  if (!text.trim()) {
    if (optional) return {};

    throw new HttpError(
      400,
      "invalid_social_request",
      "A JSON request body is required.",
    );
  }

  if (new TextEncoder().encode(text).byteLength > MAX_SOCIAL_REQUEST_BYTES) {
    throw new HttpError(
      413,
      "social_request_too_large",
      "The social account request is too large.",
    );
  }

  let body;

  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(
      400,
      "invalid_social_request",
      "The social account request contains invalid JSON.",
    );
  }

  if (!isPlainObject(body)) {
    throw new HttpError(
      400,
      "invalid_social_request",
      "The social account request must be a JSON object.",
    );
  }

  return body;
}

function readOptionalConnectionId(value) {
  if (value === undefined || value === null || value === "") return null;

  const connectionId = String(value).trim().toLowerCase();

  if (!FILM_ID_PATTERN.test(connectionId)) {
    throw new HttpError(
      400,
      "invalid_social_connection_id",
      "The social connection ID is invalid.",
    );
  }

  return connectionId;
}

function readBoundedString(value, label, maxLength) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized || normalized.length > maxLength) {
    throw new HttpError(
      400,
      "invalid_social_request",
      `The ${label} is missing or invalid.`,
    );
  }

  return normalized;
}

function readMetaObjectId(value, label) {
  const id = normalizeMetaObjectId(value);

  if (!id) {
    throw new HttpError(
      400,
      "invalid_meta_page_selection",
      `The ${label} is invalid.`,
    );
  }

  return id;
}

function normalizeMetaObjectId(value) {
  const id = String(value ?? "").trim();
  return /^\d{1,64}$/.test(id) ? id : null;
}

function sanitizeSocialText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeScopeList(scopes) {
  return Array.from(
    new Set(
      (Array.isArray(scopes) ? scopes : [])
        .map((scope) => sanitizeSocialText(scope, 82))
        .filter((scope) => /^[a-z][a-z0-9_]{1,80}$/.test(scope)),
    ),
  ).sort();
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== "string" || value.length > 64) return null;

  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

async function createMetaOAuthState(payload, secret) {
  const encodedPayload = encodeBase64UrlJson(payload);
  const signature = await signMetaState(encodedPayload, secret);
  return `${encodedPayload}.${encodeBase64UrlBytes(signature)}`;
}

async function verifyMetaOAuthState(
  state,
  configuration,
  userId,
) {
  const parts = state.split(".");

  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw invalidMetaState();
  }

  let suppliedSignature;

  try {
    suppliedSignature = decodeBase64UrlBytes(parts[1], 64);
  } catch {
    throw invalidMetaState();
  }

  if (suppliedSignature.byteLength !== 32) throw invalidMetaState();

  const key = await importMetaStateKey(
    configuration.stateSecret,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    suppliedSignature,
    new TextEncoder().encode(parts[0]),
  );

  if (!verified) throw invalidMetaState();

  let payload;

  try {
    payload = decodeBase64UrlJson(parts[0], 4096);
  } catch {
    throw invalidMetaState();
  }

  if (
    !isPlainObject(payload) ||
    payload.version !== 1 ||
    payload.purpose !== META_STATE_PURPOSE ||
    !FILM_ID_PATTERN.test(String(payload.subject ?? "")) ||
    typeof payload.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{24,80}$/.test(payload.nonce) ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.expiresAt - payload.issuedAt !==
      configuration.stateTtlSeconds ||
    payload.issuedAt > Math.floor(Date.now() / 1000) + 60
  ) {
    throw invalidMetaState();
  }

  const now = Math.floor(Date.now() / 1000);

  if (payload.expiresAt <= now) {
    throw new HttpError(
      400,
      "meta_oauth_state_expired",
      "The Meta connection attempt expired. Start again from Social Media.",
    );
  }

  if (payload.subject !== userId) {
    throw new HttpError(
      403,
      "meta_oauth_state_mismatch",
      "This Meta connection attempt belongs to a different administrator session.",
    );
  }

  return {
    replaceConnectionId: readOptionalConnectionId(
      payload.replaceConnectionId,
    ),
  };
}

function invalidMetaState() {
  return new HttpError(
    400,
    "invalid_meta_oauth_state",
    "The Meta connection state is invalid. Start again from Social Media.",
  );
}

async function signMetaState(encodedPayload, secret) {
  const key = await importMetaStateKey(secret, ["sign"]);
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(encodedPayload),
    ),
  );
}

async function importMetaStateKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

async function createMetaSelectionToken(payload, encryptionKey) {
  const envelope = await encryptMetaPayload(
    payload,
    encryptionKey,
    META_SELECTION_AAD,
  );
  return encodeBase64UrlJson(envelope);
}

async function readMetaSelectionToken(token, encryptionKey, userId) {
  let envelope;
  let payload;

  try {
    envelope = decodeBase64UrlJson(token, MAX_SOCIAL_REQUEST_BYTES);
    payload = await decryptMetaPayload(
      envelope,
      encryptionKey,
      META_SELECTION_AAD,
    );
  } catch {
    throw invalidMetaSelectionToken();
  }

  if (
    !isPlainObject(payload) ||
    payload.version !== 1 ||
    payload.purpose !== META_SELECTION_PURPOSE ||
    payload.subject !== userId ||
    !Number.isSafeInteger(payload.expiresAt)
  ) {
    throw invalidMetaSelectionToken();
  }

  if (payload.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new HttpError(
      400,
      "meta_page_selection_expired",
      "The Facebook Page selection expired. Start the Meta connection again.",
    );
  }

  const pages = (Array.isArray(payload.pages) ? payload.pages : [])
    .slice(0, MAX_META_PAGES)
    .map(normalizeSelectionPage)
    .filter(Boolean);

  if (
    !pages.length
  ) {
    throw invalidMetaSelectionToken();
  }

  return {
    tokenExpiresAt: normalizeIsoTimestamp(payload.tokenExpiresAt),
    scopes: normalizeScopeList(payload.scopes),
    pages,
    replaceConnectionId: readOptionalConnectionId(
      payload.replaceConnectionId,
    ),
  };
}

function normalizeSelectionPage(page) {
  if (!isPlainObject(page)) return null;

  const id = normalizeMetaObjectId(page.id);
  const name = sanitizeSocialText(page.name, 240);
  const pageAccessToken = typeof page.pageAccessToken === "string"
    ? page.pageAccessToken.trim()
    : "";

  if (!id || !name || !pageAccessToken || pageAccessToken.length > 16_384) {
    return null;
  }

  return {
    id,
    name,
    pageAccessToken,
    tasks: Array.from(
      new Set(
        (Array.isArray(page.tasks) ? page.tasks : [])
          .map((task) => sanitizeSocialText(task, 100))
          .filter(Boolean),
      ),
    ).slice(0, 32),
    instagramAccountId: normalizeMetaObjectId(page.instagramAccountId),
  };
}

function invalidMetaSelectionToken() {
  return new HttpError(
    400,
    "invalid_meta_page_selection",
    "The Facebook Page selection is invalid. Start the Meta connection again.",
  );
}

async function encryptMetaPayload(value, encodedKey, additionalData) {
  const key = await importMetaEncryptionKey(encodedKey, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(additionalData),
        tagLength: 128,
      },
      key,
      plaintext,
    ),
  );

  return {
    version: 1,
    algorithm: "A256GCM",
    iv: encodeBase64UrlBytes(iv),
    ciphertext: encodeBase64UrlBytes(ciphertext),
  };
}

async function decryptMetaPayload(envelope, encodedKey, additionalData) {
  if (
    !isPlainObject(envelope) ||
    envelope.version !== 1 ||
    envelope.algorithm !== "A256GCM" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("Invalid encrypted envelope");
  }

  const iv = decodeBase64UrlBytes(envelope.iv, 32);
  const ciphertext = decodeBase64UrlBytes(
    envelope.ciphertext,
    MAX_SOCIAL_REQUEST_BYTES,
  );

  if (iv.byteLength !== 12 || ciphertext.byteLength < 17) {
    throw new Error("Invalid encrypted envelope");
  }

  const key = await importMetaEncryptionKey(encodedKey, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(additionalData),
      tagLength: 128,
    },
    key,
    ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function importMetaEncryptionKey(encodedKey, usages) {
  const keyBytes = decodeBase64Secret(encodedKey);

  if (!keyBytes || keyBytes.byteLength !== 32) throw new Error("Invalid key");

  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

function metaCredentialsAad(pageId) {
  return `pace-bros:meta-credentials:${pageId}:v1`;
}

function decodeBase64Secret(value) {
  const input = String(value ?? "").trim();

  if (!input || input.length > 256) return null;

  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;

  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );

  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeBase64UrlBytes(value, maxBytes) {
  const input = String(value ?? "");

  if (
    !input ||
    !/^[A-Za-z0-9_-]+$/.test(input) ||
    input.length > Math.ceil(maxBytes * 4 / 3) + 4
  ) {
    throw new Error("Invalid base64url value");
  }

  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);

  if (binary.length > maxBytes) throw new Error("Base64url value is too large");

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeBase64UrlJson(value, maxBytes) {
  const bytes = decodeBase64UrlBytes(value, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function handleAdminAnalytics(
  request,
  env,
  executionContext,
) {
  assertAdminRequestOrigin(request, env);
  await authorizeAdmin(request, env);

  const analytics = await getAnalyticsSnapshot(
    env,
    executionContext,
  );

  return jsonResponse(analytics, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

async function getAnalyticsSnapshot(
  env,
  executionContext,
) {
  const { propertyId, credentials } =
    readAnalyticsConfiguration(env);

  const [realtimePart, historicalPart] =
    await Promise.all([
      getAnalyticsPart(
        "realtime",
        propertyId,
        getRealtimeCacheSeconds(env),
        () =>
          fetchRealtimeAnalyticsPart(
            propertyId,
            credentials,
          ),
        executionContext,
      ),
      getAnalyticsPart(
        "historical",
        propertyId,
        getHistoricalCacheSeconds(env),
        () =>
          fetchHistoricalAnalyticsPart(
            propertyId,
            credentials,
          ),
        executionContext,
      ),
    ]);

  return {
    generatedAt: realtimePart.generatedAt,
    realtime: realtimePart.data.realtime,
    today: historicalPart.data.today,
    last7Days: historicalPart.data.last7Days,
    last30Days: historicalPart.data.last30Days,
    topContent: historicalPart.data.topContent,
    trafficSources:
      historicalPart.data.trafficSources,
  };
}

async function getAnalyticsPart(
  partName,
  propertyId,
  cacheSeconds,
  loadPart,
  executionContext,
) {
  const cacheId = `${partName}:${propertyId}`;
  const now = Date.now();
  const memoryEntry =
    analyticsMemoryCache.get(cacheId);

  if (
    memoryEntry &&
    memoryEntry.expiresAt > now
  ) {
    return memoryEntry;
  }

  const cache = getDefaultWorkerCache();
  const cacheKey = new Request(
    `${ANALYTICS_CACHE_ORIGIN}/v1/${partName}/${propertyId}`,
    { method: "GET" },
  );

  if (cache) {
    try {
      const cachedResponse =
        await cache.match(cacheKey);

      if (cachedResponse) {
        const cachedEntry =
          await parseJson(cachedResponse);

        if (
          isAnalyticsCacheEntry(
            cachedEntry,
            partName,
          )
        ) {
          analyticsMemoryCache.set(
            cacheId,
            cachedEntry,
          );

          return cachedEntry;
        }
      }
    } catch (error) {
      console.error(
        "Unable to read the analytics edge cache",
        error,
      );
    }
  }

  const pending =
    analyticsPartRequestsInFlight.get(cacheId);

  if (pending) {
    return pending;
  }

  const refresh = (async () => {
    const data = await loadPart();
    const generatedAt = new Date().toISOString();
    const entry = {
      generatedAt,
      expiresAt:
        Date.now() + cacheSeconds * 1000,
      data,
    };

    analyticsMemoryCache.set(cacheId, entry);

    if (cache) {
      const cacheWrite = cache
        .put(
          cacheKey,
          jsonResponse(entry, {
            headers: {
              "Cache-Control":
                `public, max-age=${cacheSeconds}`,
            },
          }),
        )
        .catch((error) => {
          console.error(
            "Unable to write the analytics edge cache",
            error,
          );
        });

      if (
        executionContext &&
        typeof executionContext.waitUntil ===
          "function"
      ) {
        executionContext.waitUntil(cacheWrite);
      } else {
        await cacheWrite;
      }
    }

    return entry;
  })();

  analyticsPartRequestsInFlight.set(
    cacheId,
    refresh,
  );

  try {
    return await refresh;
  } finally {
    if (
      analyticsPartRequestsInFlight.get(
        cacheId,
      ) === refresh
    ) {
      analyticsPartRequestsInFlight.delete(
        cacheId,
      );
    }
  }
}

async function fetchRealtimeAnalyticsPart(
  propertyId,
  credentials,
) {
  const accessToken =
    await getGoogleAccessToken(credentials);

  const report = await requestGoogleAnalytics(
    `${GOOGLE_ANALYTICS_API_ORIGIN}/v1beta/properties/${propertyId}:runRealtimeReport`,
    accessToken,
    {
      metrics: [
        { name: "activeUsers" },
        { name: "screenPageViews" },
        { name: "eventCount" },
      ],
    },
    "realtime report",
  );

  return {
    realtime: {
      activeUsers: reportCount(
        report,
        "activeUsers",
      ),
      views: reportCount(
        report,
        "screenPageViews",
      ),
      eventCount: reportCount(
        report,
        "eventCount",
      ),
    },
  };
}

async function fetchHistoricalAnalyticsPart(
  propertyId,
  credentials,
) {
  const accessToken =
    await getGoogleAccessToken(credentials);

  const summaryMetrics = [
    { name: "totalUsers" },
    { name: "newUsers" },
    { name: "sessions" },
    { name: "screenPageViews" },
    { name: "activeUsers" },
    { name: "userEngagementDuration" },
    { name: "eventCount" },
  ];

  const batch = await requestGoogleAnalytics(
    `${GOOGLE_ANALYTICS_API_ORIGIN}/v1beta/properties/${propertyId}:batchRunReports`,
    accessToken,
    {
      requests: [
        {
          dateRanges: [
            {
              startDate: "today",
              endDate: "today",
            },
          ],
          metrics: summaryMetrics,
        },
        {
          dateRanges: [
            {
              startDate: "6daysAgo",
              endDate: "today",
            },
          ],
          metrics: summaryMetrics,
        },
        {
          dateRanges: [
            {
              startDate: "29daysAgo",
              endDate: "today",
            },
          ],
          metrics: summaryMetrics,
        },
        {
          dateRanges: [
            {
              startDate: "29daysAgo",
              endDate: "today",
            },
          ],
          dimensions: [
            { name: "pageTitle" },
            { name: "pagePath" },
          ],
          metrics: [
            { name: "screenPageViews" },
          ],
          orderBys: [
            {
              metric: {
                metricName:
                  "screenPageViews",
              },
              desc: true,
            },
          ],
          limit: String(TOP_CONTENT_LIMIT),
        },
        {
          dateRanges: [
            {
              startDate: "29daysAgo",
              endDate: "today",
            },
          ],
          dimensions: [
            { name: "sessionSource" },
            { name: "sessionMedium" },
          ],
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
          ],
          orderBys: [
            {
              metric: {
                metricName: "sessions",
              },
              desc: true,
            },
          ],
          limit: String(
            TRAFFIC_SOURCE_LIMIT,
          ),
        },
      ],
    },
    "historical reports",
  );

  if (
    !Array.isArray(batch?.reports) ||
    batch.reports.length < 5
  ) {
    throw analyticsUnavailable();
  }

  const [
    todayReport,
    last7DaysReport,
    last30DaysReport,
    topContentReport,
    trafficSourcesReport,
  ] = batch.reports;

  const today = normalizeHistoricalSummary(
    todayReport,
  );
  const last7Days =
    normalizeHistoricalSummary(
      last7DaysReport,
    );
  const last30Days =
    normalizeHistoricalSummary(
      last30DaysReport,
    );

  return {
    today,
    last7Days,
    last30Days,
    topContent: normalizeTopContent(
      topContentReport,
    ),
    trafficSources: normalizeTrafficSources(
      trafficSourcesReport,
      last30Days.sessions,
    ),
  };
}

async function requestGoogleAnalytics(
  url,
  accessToken,
  body,
  reportName,
) {
  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error(
      `Google Analytics ${reportName} request failed`,
      error,
    );

    throw analyticsUnavailable();
  }

  if (!response.ok) {
    console.error(
      `Google Analytics ${reportName} returned HTTP ${response.status}`,
    );

    throw analyticsUnavailable();
  }

  const payload = await parseJson(response);

  if (!payload || typeof payload !== "object") {
    throw analyticsUnavailable();
  }

  return payload;
}

async function getGoogleAccessToken(credentials) {
  const now = Date.now();

  if (
    googleAccessTokenCache?.clientEmail ===
      credentials.clientEmail &&
    googleAccessTokenCache.expiresAt >
      now + 30_000
  ) {
    return googleAccessTokenCache.token;
  }

  if (
    googleAccessTokenInFlight?.clientEmail ===
    credentials.clientEmail
  ) {
    return googleAccessTokenInFlight.promise;
  }

  const tokenRequest =
    fetchGoogleAccessToken(credentials);

  googleAccessTokenInFlight = {
    clientEmail: credentials.clientEmail,
    promise: tokenRequest,
  };

  try {
    return await tokenRequest;
  } finally {
    if (
      googleAccessTokenInFlight?.promise ===
      tokenRequest
    ) {
      googleAccessTokenInFlight = null;
    }
  }
}

async function fetchGoogleAccessToken(
  credentials,
) {
  const assertion =
    await createServiceAccountAssertion(
      credentials,
    );

  const form = new URLSearchParams();
  form.set(
    "grant_type",
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
  );
  form.set("assertion", assertion);

  let response;

  try {
    response = await fetch(
      GOOGLE_OAUTH_TOKEN_URL,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body: form,
      },
    );
  } catch (error) {
    console.error(
      "Google OAuth token request failed",
      error,
    );

    throw analyticsAuthenticationFailed();
  }

  const payload = await parseJson(response);

  if (
    !response.ok ||
    typeof payload?.access_token !== "string" ||
    !payload.access_token
  ) {
    console.error(
      `Google OAuth returned HTTP ${response.status}`,
    );

    throw analyticsAuthenticationFailed();
  }

  const expiresIn = Number(
    payload.expires_in ?? 3600,
  );
  const safeExpiresIn =
    Number.isFinite(expiresIn) &&
    expiresIn > 120
      ? expiresIn
      : 3600;

  googleAccessTokenCache = {
    clientEmail: credentials.clientEmail,
    token: payload.access_token,
    expiresAt:
      Date.now() +
      (safeExpiresIn - 60) * 1000,
  };

  return payload.access_token;
}

async function createServiceAccountAssertion(
  credentials,
) {
  const issuedAt = Math.floor(
    Date.now() / 1000,
  );
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  if (credentials.privateKeyId) {
    header.kid = credentials.privateKeyId;
  }

  const claims = {
    iss: credentials.clientEmail,
    scope: GOOGLE_ANALYTICS_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };

  const unsignedToken =
    `${encodeBase64UrlJson(header)}.` +
    encodeBase64UrlJson(claims);

  let privateKey;
  let signature;

  try {
    privateKey = await crypto.subtle.importKey(
      "pkcs8",
      decodePem(credentials.privateKey),
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["sign"],
    );

    signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(
        unsignedToken,
      ),
    );
  } catch (error) {
    console.error(
      "Google service-account signing failed",
      error,
    );

    throw analyticsNotConfigured();
  }

  return (
    `${unsignedToken}.` +
    encodeBase64UrlBytes(
      new Uint8Array(signature),
    )
  );
}

function readAnalyticsConfiguration(env) {
  const propertyId = String(
    env.GA4_PROPERTY_ID ?? "",
  ).trim();
  const rawCredentials = String(
    env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
  ).trim();

  if (
    !/^\d{1,32}$/.test(propertyId) ||
    !rawCredentials
  ) {
    throw analyticsNotConfigured();
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(
      rawCredentials,
    );
  } catch {
    throw analyticsNotConfigured();
  }

  const clientEmail = String(
    serviceAccount?.client_email ?? "",
  ).trim();
  const privateKey = String(
    serviceAccount?.private_key ?? "",
  ).trim();
  const privateKeyId = String(
    serviceAccount?.private_key_id ?? "",
  ).trim();

  if (
    serviceAccount?.type !==
      "service_account" ||
    !/^\S+@\S+$/.test(clientEmail) ||
    !privateKey.includes(
      "-----BEGIN PRIVATE KEY-----",
    ) ||
    !privateKey.includes(
      "-----END PRIVATE KEY-----",
    )
  ) {
    throw analyticsNotConfigured();
  }

  return {
    propertyId,
    credentials: {
      clientEmail,
      privateKey,
      privateKeyId,
    },
  };
}

function getRealtimeCacheSeconds(env) {
  return getBoundedCacheSeconds(
    env.ANALYTICS_REALTIME_CACHE_SECONDS,
    DEFAULT_REALTIME_CACHE_SECONDS,
    30,
    120,
  );
}

function getHistoricalCacheSeconds(env) {
  return getBoundedCacheSeconds(
    env.ANALYTICS_HISTORICAL_CACHE_SECONDS,
    DEFAULT_HISTORICAL_CACHE_SECONDS,
    120,
    1800,
  );
}

function getBoundedCacheSeconds(
  configured,
  fallback,
  minimum,
  maximum,
) {
  const seconds = Number(configured);

  return Number.isSafeInteger(seconds) &&
    seconds >= minimum &&
    seconds <= maximum
    ? seconds
    : fallback;
}

function normalizeHistoricalSummary(report) {
  const activeUsers = reportNumber(
    report,
    "activeUsers",
  );
  const userEngagementDuration =
    reportNumber(
      report,
      "userEngagementDuration",
    );

  return {
    totalUsers: reportCount(
      report,
      "totalUsers",
    ),
    newUsers: reportCount(
      report,
      "newUsers",
    ),
    sessions: reportCount(
      report,
      "sessions",
    ),
    views: reportCount(
      report,
      "screenPageViews",
    ),
    averageEngagementTimeSeconds:
      activeUsers > 0
        ? roundNumber(
            userEngagementDuration /
              activeUsers,
            1,
          )
        : 0,
    eventCount: reportCount(
      report,
      "eventCount",
    ),
  };
}

function normalizeTopContent(report) {
  const rows = Array.isArray(report?.rows)
    ? report.rows
    : [];

  return rows
    .slice(0, TOP_CONTENT_LIMIT)
    .map((row) => {
      const path = sanitizeAnalyticsText(
        reportDimension(
          report,
          row,
          "pagePath",
        ),
        512,
      );
      const title = sanitizeAnalyticsText(
        reportDimension(
          report,
          row,
          "pageTitle",
        ),
        240,
      );

      return {
        title: title || path || "(not set)",
        path,
        views: reportCount(
          report,
          "screenPageViews",
          row,
        ),
      };
    });
}

function normalizeTrafficSources(
  report,
  totalSessions,
) {
  const rows = Array.isArray(report?.rows)
    ? report.rows
    : [];

  return rows
    .slice(0, TRAFFIC_SOURCE_LIMIT)
    .map((row) => {
      const sessions = reportCount(
        report,
        "sessions",
        row,
      );

      return {
        source:
          sanitizeAnalyticsText(
            reportDimension(
              report,
              row,
              "sessionSource",
            ),
            160,
          ) || "(not set)",
        medium:
          sanitizeAnalyticsText(
            reportDimension(
              report,
              row,
              "sessionMedium",
            ),
            120,
          ) || "(not set)",
        sessions,
        users: reportCount(
          report,
          "totalUsers",
          row,
        ),
        percentage:
          totalSessions > 0
            ? roundNumber(
                (sessions /
                  totalSessions) *
                  100,
                1,
              )
            : 0,
      };
    });
}

function reportCount(
  report,
  metricName,
  row = undefined,
) {
  return Math.max(
    0,
    Math.round(
      reportNumber(
        report,
        metricName,
        row,
      ),
    ),
  );
}

function reportNumber(
  report,
  metricName,
  row = undefined,
) {
  const reportRow =
    row ?? report?.rows?.[0];
  const headers = Array.isArray(
    report?.metricHeaders,
  )
    ? report.metricHeaders
    : [];
  const index = headers.findIndex(
    (header) =>
      header?.name === metricName,
  );

  if (
    index < 0 ||
    !Array.isArray(reportRow?.metricValues)
  ) {
    return 0;
  }

  const value = Number(
    reportRow.metricValues[index]?.value,
  );

  return Number.isFinite(value) ? value : 0;
}

function reportDimension(
  report,
  row,
  dimensionName,
) {
  const headers = Array.isArray(
    report?.dimensionHeaders,
  )
    ? report.dimensionHeaders
    : [];
  const index = headers.findIndex(
    (header) =>
      header?.name === dimensionName,
  );

  if (
    index < 0 ||
    !Array.isArray(row?.dimensionValues)
  ) {
    return "";
  }

  return row.dimensionValues[index]?.value ?? "";
}

function sanitizeAnalyticsText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function roundNumber(value, decimalPlaces) {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}

function isAnalyticsCacheEntry(
  entry,
  partName,
) {
  if (
    !entry ||
    typeof entry !== "object" ||
    typeof entry.generatedAt !== "string" ||
    !Number.isFinite(entry.expiresAt) ||
    entry.expiresAt <= Date.now() ||
    !entry.data ||
    typeof entry.data !== "object"
  ) {
    return false;
  }

  if (partName === "realtime") {
    return (
      entry.data.realtime &&
      typeof entry.data.realtime === "object"
    );
  }

  return (
    entry.data.today &&
    entry.data.last7Days &&
    entry.data.last30Days &&
    Array.isArray(entry.data.topContent) &&
    Array.isArray(
      entry.data.trafficSources,
    )
  );
}

function getDefaultWorkerCache() {
  try {
    return typeof caches === "undefined"
      ? null
      : caches.default;
  } catch {
    return null;
  }
}

function encodeBase64UrlJson(value) {
  return encodeBase64UrlBytes(
    new TextEncoder().encode(
      JSON.stringify(value),
    ),
  );
}

function encodeBase64UrlBytes(bytes) {
  let binary = "";

  for (
    let index = 0;
    index < bytes.length;
    index += 1
  ) {
    binary += String.fromCharCode(
      bytes[index],
    );
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodePem(pem) {
  const encoded = pem
    .replace(
      /-----BEGIN PRIVATE KEY-----/g,
      "",
    )
    .replace(
      /-----END PRIVATE KEY-----/g,
      "",
    )
    .replace(/\s/g, "");

  const binary = atob(encoded);
  const bytes = new Uint8Array(
    binary.length,
  );

  for (
    let index = 0;
    index < binary.length;
    index += 1
  ) {
    bytes[index] =
      binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function analyticsNotConfigured() {
  return new HttpError(
    503,
    "analytics_not_configured",
    "Analytics is not configured for this service.",
  );
}

function analyticsAuthenticationFailed() {
  return new HttpError(
    502,
    "analytics_authentication_failed",
    "Analytics is temporarily unavailable.",
  );
}

function analyticsUnavailable() {
  return new HttpError(
    502,
    "analytics_unavailable",
    "Analytics is temporarily unavailable.",
  );
}

async function authorizeAdmin(request, env) {
  const token = readBearerToken(request);
  const supabaseUrl = readSupabaseUrl(env);

  const publishableKey = String(
    env.SUPABASE_PUBLISHABLE_KEY ?? "",
  ).trim();

  if (!publishableKey) {
    throw new HttpError(
      500,
      "worker_not_configured",
      "The media service is missing its Supabase configuration.",
    );
  }

  let userResponse;

  try {
    userResponse = await fetch(
      new URL("/auth/v1/user", supabaseUrl),
      {
        headers: {
          Accept: "application/json",
          apikey: publishableKey,
          Authorization: `Bearer ${token}`,
        },
      },
    );
  } catch {
    throw new HttpError(
      502,
      "authorization_unavailable",
      "Administrator authorization is temporarily unavailable.",
    );
  }

  if (
    userResponse.status === 401 ||
    userResponse.status === 403
  ) {
    throw new HttpError(
      401,
      "invalid_token",
      "A valid administrator session is required.",
    );
  }

  if (!userResponse.ok) {
    throw new HttpError(
      502,
      "authorization_unavailable",
      "Administrator authorization is temporarily unavailable.",
    );
  }

  const user = await parseJson(userResponse);

  if (
    !user?.id ||
    !FILM_ID_PATTERN.test(user.id)
  ) {
    throw new HttpError(
      401,
      "invalid_token",
      "A valid administrator session is required.",
    );
  }

  const adminUrl = new URL(
    "/rest/v1/admin_users",
    supabaseUrl,
  );

  adminUrl.searchParams.set("select", "user_id");
  adminUrl.searchParams.set(
    "user_id",
    `eq.${user.id}`,
  );
  adminUrl.searchParams.set("limit", "1");

  let adminResponse;

  try {
    adminResponse = await fetch(adminUrl, {
      headers: {
        Accept: "application/json",
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new HttpError(
      502,
      "authorization_unavailable",
      "Administrator authorization is temporarily unavailable.",
    );
  }

  if (!adminResponse.ok) {
    if (
      adminResponse.status === 401 ||
      adminResponse.status === 403
    ) {
      throw new HttpError(
        401,
        "invalid_token",
        "A valid administrator session is required.",
      );
    }

    throw new HttpError(
      502,
      "authorization_unavailable",
      "Administrator authorization is temporarily unavailable.",
    );
  }

  const adminRows = await parseJson(adminResponse);

  if (
    !Array.isArray(adminRows) ||
    !adminRows.some(
      (row) => row?.user_id === user.id,
    )
  ) {
    throw new HttpError(
      403,
      "administrator_required",
      "This account is not authorized to manage Pace Bros media.",
    );
  }

  return {
    userId: user.id,
    accessToken: token,
  };
}

function readFilmId(request) {
  const filmId = request.headers
    .get("X-Film-Id")
    ?.trim()
    .toLowerCase();

  if (
    !filmId ||
    !FILM_ID_PATTERN.test(filmId)
  ) {
    throw new HttpError(
      400,
      "invalid_film_id",
      "X-Film-Id must contain the film UUID.",
    );
  }

  return filmId;
}

function readMultipartIdentity(url) {
  const key = url.searchParams.get("key")?.trim();
  const uploadId =
    url.searchParams.get("uploadId")?.trim();

  if (
    !key ||
    !VIDEO_KEY_PATTERN.test(key)
  ) {
    throw new HttpError(
      400,
      "invalid_media_key",
      "The multipart video key is invalid.",
    );
  }

  if (
    !uploadId ||
    uploadId.length > 2048
  ) {
    throw new HttpError(
      400,
      "invalid_upload_id",
      "The multipart upload ID is invalid.",
    );
  }

  return { key, uploadId };
}

function readPartNumber(url) {
  const raw =
    url.searchParams.get("partNumber");

  if (!raw || !/^\d+$/.test(raw)) {
    throw new HttpError(
      400,
      "invalid_part_number",
      "A valid multipart part number is required.",
    );
  }

  const partNumber = Number(raw);

  if (
    !Number.isSafeInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > 10_000
  ) {
    throw new HttpError(
      400,
      "invalid_part_number",
      "Multipart part numbers must be between 1 and 10000.",
    );
  }

  return partNumber;
}

function validateUploadedParts(parts) {
  if (
    !Array.isArray(parts) ||
    parts.length < 1 ||
    parts.length > 10_000
  ) {
    throw new HttpError(
      400,
      "invalid_multipart_parts",
      "A valid multipart parts list is required.",
    );
  }

  const seen = new Set();

  const normalized = parts.map((part) => {
    const partNumber = Number(part?.partNumber);
    const etag =
      typeof part?.etag === "string"
        ? part.etag.trim()
        : "";

    if (
      !Number.isSafeInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > 10_000 ||
      !etag ||
      etag.length > 2048
    ) {
      throw new HttpError(
        400,
        "invalid_multipart_parts",
        "One or more multipart parts are invalid.",
      );
    }

    if (seen.has(partNumber)) {
      throw new HttpError(
        400,
        "duplicate_part_number",
        "Multipart part numbers must be unique.",
      );
    }

    seen.add(partNumber);

    return {
      partNumber,
      etag,
    };
  });

  normalized.sort(
    (first, second) =>
      first.partNumber - second.partNumber,
  );

  for (
    let index = 0;
    index < normalized.length;
    index += 1
  ) {
    if (
      normalized[index].partNumber !==
      index + 1
    ) {
      throw new HttpError(
        400,
        "invalid_part_sequence",
        "Multipart parts must form one continuous sequence.",
      );
    }
  }

  return normalized;
}

function readBearerToken(request) {
  const authorization =
    request.headers.get("Authorization") ?? "";

  const match = authorization.match(
    /^Bearer\s+([^\s]+)$/i,
  );

  if (
    !match ||
    match[1].length > 8192
  ) {
    throw new HttpError(
      401,
      "missing_token",
      "A valid administrator session is required.",
    );
  }

  return match[1];
}

function readSupabaseUrl(env) {
  try {
    const url = new URL(
      String(env.SUPABASE_URL ?? ""),
    );

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      throw new Error("Unsupported protocol");
    }

    return url;
  } catch {
    throw new HttpError(
      500,
      "worker_not_configured",
      "The media service is missing its Supabase configuration.",
    );
  }
}

function assertBucketBinding(env) {
  if (!env.MEDIA_BUCKET) {
    throw new HttpError(
      500,
      "worker_not_configured",
      "The MEDIA_BUCKET binding is not configured.",
    );
  }
}

function assertAdminRequestOrigin(request, env) {
  const origin = request.headers.get("Origin");

  if (
    origin &&
    !getAllowedOrigins(env).has(origin)
  ) {
    throw new HttpError(
      403,
      "origin_not_allowed",
      "This origin is not allowed.",
    );
  }
}

function getAllowedOrigins(env) {
  const configured = String(
    env.ALLOWED_ORIGINS ??
      DEFAULT_ALLOWED_ORIGIN,
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(
    configured.length
      ? configured
      : [DEFAULT_ALLOWED_ORIGIN],
  );
}

function getMaxUploadBytes(env) {
  const configured = Number(
    env.MAX_UPLOAD_BYTES ??
      DEFAULT_MAX_UPLOAD_BYTES,
  );

  return Number.isSafeInteger(configured) &&
    configured > 0
    ? configured
    : DEFAULT_MAX_UPLOAD_BYTES;
}

function readDeclaredSize(request) {
  const header =
    request.headers.get("Content-Length");

  if (header === null) return null;

  if (!/^\d+$/.test(header)) {
    throw new HttpError(
      400,
      "invalid_content_length",
      "Content-Length must be a valid byte count.",
    );
  }

  const size = Number(header);

  if (!Number.isSafeInteger(size)) {
    throw new HttpError(
      400,
      "invalid_content_length",
      "Content-Length must be a valid byte count.",
    );
  }

  return size;
}

function uploadTooLarge(maxUploadBytes) {
  const maxMegabytes = Math.floor(
    maxUploadBytes / 1_000_000,
  );

  return new HttpError(
    413,
    "upload_too_large",
    `This production pass accepts files up to ${maxMegabytes} MB per request.`,
  );
}

function readObjectKey(pathname) {
  let objectKey;

  try {
    objectKey = decodeURIComponent(
      pathname.slice(
        MEDIA_ROUTE_PREFIX.length,
      ),
    );
  } catch {
    throw new HttpError(
      400,
      "invalid_media_key",
      "The media key is malformed.",
    );
  }

  if (
    !objectKey ||
    !MEDIA_KEY_PATTERN.test(objectKey)
  ) {
    throw new HttpError(
      400,
      "invalid_media_key",
      "The media key is invalid.",
    );
  }

  return objectKey;
}

function normalizeContentType(value) {
  return String(value ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function parseSingleRange(header, totalSize) {
  if (
    !Number.isSafeInteger(totalSize) ||
    totalSize <= 0
  ) {
    return null;
  }

  const match =
    /^bytes=(\d*)-(\d*)$/i.exec(
      header.trim(),
    );

  if (
    !match ||
    (!match[1] && !match[2])
  ) {
    return null;
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);

    if (
      !Number.isSafeInteger(suffixLength) ||
      suffixLength <= 0
    ) {
      return null;
    }

    const length = Math.min(
      suffixLength,
      totalSize,
    );

    const offset = totalSize - length;
    const end = totalSize - 1;

    return {
      offset,
      length,
      end,
    };
  }

  const offset = Number(match[1]);

  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset >= totalSize
  ) {
    return null;
  }

  let end = match[2]
    ? Number(match[2])
    : totalSize - 1;

  if (
    !Number.isSafeInteger(end) ||
    end < offset
  ) {
    return null;
  }

  end = Math.min(
    end,
    totalSize - 1,
  );

  return {
    offset,
    length: end - offset + 1,
    end,
  };
}

function mediaHeaders(object) {
  const headers = new Headers();

  object.writeHttpMetadata(headers);

  headers.set(
    "Accept-Ranges",
    "bytes",
  );

  headers.set(
    "ETag",
    object.httpEtag,
  );

  headers.set(
    "Last-Modified",
    object.uploaded.toUTCString(),
  );

  headers.set(
    "X-Content-Type-Options",
    "nosniff",
  );

  if (!headers.has("Cache-Control")) {
    headers.set(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
  }

  return headers;
}

function fixedLengthBody(body, length) {
  return body.pipeThrough(
    new FixedLengthStream(length),
  );
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function jsonResponse(body, init = {}) {
  const headers = new Headers(
    init.headers,
  );

  headers.set(
    "Content-Type",
    "application/json; charset=utf-8",
  );

  return new Response(
    JSON.stringify(body),
    {
      ...init,
      headers,
    },
  );
}

function errorResponse(
  status,
  code,
  message,
  extraHeaders = undefined,
) {
  const headers = new Headers(
    extraHeaders,
  );

  headers.set(
    "Cache-Control",
    "no-store",
  );

  return jsonResponse(
    {
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers,
    },
  );
}

function applyCors(response, request, env) {
  const origin =
    request.headers.get("Origin");

  if (
    !origin ||
    !getAllowedOrigins(env).has(origin)
  ) {
    return response;
  }

  const headers = response.headers;

  headers.set(
    "Access-Control-Allow-Origin",
    origin,
  );

  headers.set(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Length, Content-Range, ETag",
  );

  appendVary(headers, "Origin");

  if (request.method === "OPTIONS") {
    appendVary(
      headers,
      "Access-Control-Request-Method",
    );

    appendVary(
      headers,
      "Access-Control-Request-Headers",
    );
  }

  return response;
}

function appendVary(headers, value) {
  const existing =
    headers
      .get("Vary")
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];

  if (
    !existing.some(
      (entry) =>
        entry.toLowerCase() ===
        value.toLowerCase(),
    )
  ) {
    existing.push(value);
  }

  headers.set(
    "Vary",
    existing.join(", "),
  );
}
