const MEDIA_ROUTE_PREFIX = "/media/";
const DEFAULT_ALLOWED_ORIGIN = "https://dohnnyj3pp.github.io";
const DEFAULT_MAX_UPLOAD_BYTES = 95_000_000;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "DELETE", "OPTIONS"]);
const ALLOWED_REQUEST_HEADERS = new Set([
  "authorization",
  "content-type",
  "range",
  "x-film-id",
]);

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const FILM_ID_PATTERN = new RegExp(`^${UUID_PATTERN}$`, "i");
const MEDIA_KEY_PATTERN = new RegExp(
  `^films/${UUID_PATTERN}/(?:video/${UUID_PATTERN}\\.mp4|poster/${UUID_PATTERN}\\.(?:jpg|png|webp))$`,
  "i",
);

const UPLOAD_TYPES = new Map([
  ["/upload/video", {
    kind: "video",
    mimeTypes: new Map([
      ["video/mp4", { extension: "mp4", contentType: "video/mp4" }],
    ]),
  }],
  ["/upload/poster", {
    kind: "poster",
    mimeTypes: new Map([
      ["image/jpeg", { extension: "jpg", contentType: "image/jpeg" }],
      ["image/jpg", { extension: "jpg", contentType: "image/jpeg" }],
      ["image/png", { extension: "png", contentType: "image/png" }],
      ["image/webp", { extension: "webp", contentType: "image/webp" }],
    ]),
  }],
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
  async fetch(request, env) {
    let response;

    try {
      response = await routeRequest(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        response = errorResponse(error.status, error.code, error.message, error.headers);
      } else {
        console.error("Unhandled Pace Bros media Worker error", error);
        response = errorResponse(500, "internal_error", "The media service could not complete the request.");
      }
    }

    return applyCors(response, request, env);
  },
};

async function routeRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return handlePreflight(request, env);
  }

  const uploadType = UPLOAD_TYPES.get(url.pathname);
  if (uploadType) {
    if (request.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "This upload route only accepts POST requests.", {
        Allow: "POST, OPTIONS",
      });
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

    throw new HttpError(405, "method_not_allowed", "This media route does not accept that method.", {
      Allow: "GET, HEAD, DELETE, OPTIONS",
    });
  }

  throw new HttpError(404, "not_found", "Route not found.");
}

function handlePreflight(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !getAllowedOrigins(env).has(origin)) {
    throw new HttpError(403, "origin_not_allowed", "This origin is not allowed.");
  }

  const requestedMethod = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
  if (requestedMethod && !ALLOWED_METHODS.has(requestedMethod)) {
    throw new HttpError(405, "method_not_allowed", "The requested method is not allowed.");
  }

  const requestedHeaders = request.headers
    .get("Access-Control-Request-Headers")
    ?.split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean) ?? [];

  if (requestedHeaders.some((header) => !ALLOWED_REQUEST_HEADERS.has(header))) {
    throw new HttpError(403, "headers_not_allowed", "One or more requested headers are not allowed.");
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Range, X-Film-Id",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function handleUpload(request, env, uploadType) {
  assertBucketBinding(env);
  assertAdminRequestOrigin(request, env);
  const { userId } = await authorizeAdmin(request, env);

  const filmId = request.headers.get("X-Film-Id")?.trim().toLowerCase();
  if (!filmId || !FILM_ID_PATTERN.test(filmId)) {
    throw new HttpError(400, "invalid_film_id", "X-Film-Id must contain the film UUID.");
  }

  const suppliedContentType = normalizeContentType(request.headers.get("Content-Type"));
  const mediaType = uploadType.mimeTypes.get(suppliedContentType);
  if (!mediaType) {
    const expected = uploadType.kind === "video" ? "an MP4 video" : "a JPG, PNG, or WebP image";
    throw new HttpError(415, "unsupported_media_type", `Upload ${expected} with its correct Content-Type.`);
  }

  if (!request.body) {
    throw new HttpError(400, "empty_upload", "The upload body is empty.");
  }

  const maxUploadBytes = getMaxUploadBytes(env);
  const declaredSize = readDeclaredSize(request);
  if (declaredSize !== null && declaredSize > maxUploadBytes) {
    throw uploadTooLarge(maxUploadBytes);
  }
  if (declaredSize === 0) {
    throw new HttpError(400, "empty_upload", "The upload body is empty.");
  }

  const objectId = crypto.randomUUID();
  const objectKey = `films/${filmId}/${uploadType.kind}/${objectId}.${mediaType.extension}`;
  const storedObject = await env.MEDIA_BUCKET.put(objectKey, request.body, {
    httpMetadata: {
      contentType: mediaType.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: {
      filmId,
      mediaKind: uploadType.kind,
      uploadedBy: userId,
    },
  });

  if (storedObject.size === 0) {
    await env.MEDIA_BUCKET.delete(objectKey);
    throw new HttpError(400, "empty_upload", "The upload body is empty.");
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
    if (!object) throw new HttpError(404, "media_not_found", "Media not found.");

    const headers = mediaHeaders(object);
    return new Response(null, { status: 200, headers });
  }

  const rangeHeader = request.headers.get("Range");
  if (!rangeHeader) {
    const object = await env.MEDIA_BUCKET.get(objectKey);
    if (!object) throw new HttpError(404, "media_not_found", "Media not found.");

    const headers = mediaHeaders(object);
    return new Response(fixedLengthBody(object.body, object.size), { status: 200, headers });
  }

  const metadata = await env.MEDIA_BUCKET.head(objectKey);
  if (!metadata) throw new HttpError(404, "media_not_found", "Media not found.");

  const range = parseSingleRange(rangeHeader, metadata.size);
  if (!range) {
    throw new HttpError(416, "invalid_range", "The requested byte range cannot be served.", {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes */${metadata.size}`,
    });
  }

  const object = await env.MEDIA_BUCKET.get(objectKey, {
    range: { offset: range.offset, length: range.length },
  });
  if (!object) throw new HttpError(404, "media_not_found", "Media not found.");

  const headers = mediaHeaders(object);
  headers.set("Content-Range", `bytes ${range.offset}-${range.end}/${metadata.size}`);

  return new Response(fixedLengthBody(object.body, range.length), { status: 206, headers });
}

async function authorizeAdmin(request, env) {
  const token = readBearerToken(request);
  const supabaseUrl = readSupabaseUrl(env);
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();

  if (!publishableKey) {
    throw new HttpError(500, "worker_not_configured", "The media service is missing its Supabase configuration.");
  }

  let userResponse;
  try {
    userResponse = await fetch(new URL("/auth/v1/user", supabaseUrl), {
      headers: {
        Accept: "application/json",
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new HttpError(502, "authorization_unavailable", "Administrator authorization is temporarily unavailable.");
  }

  if (userResponse.status === 401 || userResponse.status === 403) {
    throw new HttpError(401, "invalid_token", "A valid administrator session is required.");
  }
  if (!userResponse.ok) {
    throw new HttpError(502, "authorization_unavailable", "Administrator authorization is temporarily unavailable.");
  }

  const user = await parseJson(userResponse);
  if (!user?.id || !FILM_ID_PATTERN.test(user.id)) {
    throw new HttpError(401, "invalid_token", "A valid administrator session is required.");
  }

  const adminUrl = new URL("/rest/v1/admin_users", supabaseUrl);
  adminUrl.searchParams.set("select", "user_id");
  adminUrl.searchParams.set("user_id", `eq.${user.id}`);
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
    throw new HttpError(502, "authorization_unavailable", "Administrator authorization is temporarily unavailable.");
  }

  if (!adminResponse.ok) {
    if (adminResponse.status === 401 || adminResponse.status === 403) {
      throw new HttpError(401, "invalid_token", "A valid administrator session is required.");
    }
    throw new HttpError(502, "authorization_unavailable", "Administrator authorization is temporarily unavailable.");
  }

  const adminRows = await parseJson(adminResponse);
  if (!Array.isArray(adminRows) || !adminRows.some((row) => row?.user_id === user.id)) {
    throw new HttpError(403, "administrator_required", "This account is not authorized to manage Pace Bros media.");
  }

  return { userId: user.id };
}

function readBearerToken(request) {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || match[1].length > 8192) {
    throw new HttpError(401, "missing_token", "A valid administrator session is required.");
  }
  return match[1];
}

function readSupabaseUrl(env) {
  try {
    const url = new URL(String(env.SUPABASE_URL ?? ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported protocol");
    return url;
  } catch {
    throw new HttpError(500, "worker_not_configured", "The media service is missing its Supabase configuration.");
  }
}

function assertBucketBinding(env) {
  if (!env.MEDIA_BUCKET) {
    throw new HttpError(500, "worker_not_configured", "The MEDIA_BUCKET binding is not configured.");
  }
}

function assertAdminRequestOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (origin && !getAllowedOrigins(env).has(origin)) {
    throw new HttpError(403, "origin_not_allowed", "This origin is not allowed.");
  }
}

function getAllowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : [DEFAULT_ALLOWED_ORIGIN]);
}

function getMaxUploadBytes(env) {
  const configured = Number(env.MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_UPLOAD_BYTES;
}

function readDeclaredSize(request) {
  const header = request.headers.get("Content-Length");
  if (header === null) return null;
  if (!/^\d+$/.test(header)) {
    throw new HttpError(400, "invalid_content_length", "Content-Length must be a valid byte count.");
  }

  const size = Number(header);
  if (!Number.isSafeInteger(size)) {
    throw new HttpError(400, "invalid_content_length", "Content-Length must be a valid byte count.");
  }
  return size;
}

function uploadTooLarge(maxUploadBytes) {
  const maxMegabytes = Math.floor(maxUploadBytes / 1_000_000);
  return new HttpError(
    413,
    "upload_too_large",
    `This production pass accepts files up to ${maxMegabytes} MB per upload.`,
  );
}

function readObjectKey(pathname) {
  let objectKey;
  try {
    objectKey = decodeURIComponent(pathname.slice(MEDIA_ROUTE_PREFIX.length));
  } catch {
    throw new HttpError(400, "invalid_media_key", "The media key is malformed.");
  }

  if (!objectKey || !MEDIA_KEY_PATTERN.test(objectKey)) {
    throw new HttpError(400, "invalid_media_key", "The media key is invalid.");
  }
  return objectKey;
}

function normalizeContentType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLowerCase();
}

function parseSingleRange(header, totalSize) {
  if (!Number.isSafeInteger(totalSize) || totalSize <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(suffixLength, totalSize);
    const offset = totalSize - length;
    return { offset, length, end: totalSize - 1 };
  }

  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= totalSize) return null;

  let end = match[2] ? Number(match[2]) : totalSize - 1;
  if (!Number.isSafeInteger(end) || end < offset) return null;
  end = Math.min(end, totalSize - 1);

  return { offset, length: end - offset + 1, end };
}

function mediaHeaders(object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", object.httpEtag);
  headers.set("Last-Modified", object.uploaded.toUTCString());
  headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return headers;
}

function fixedLengthBody(body, length) {
  return body.pipeThrough(new FixedLengthStream(length));
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorResponse(status, code, message, extraHeaders = undefined) {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  return jsonResponse({ error: { code, message } }, { status, headers });
}

function applyCors(response, request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !getAllowedOrigins(env).has(origin)) return response;

  const headers = response.headers;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, ETag");
  appendVary(headers, "Origin");

  if (request.method === "OPTIONS") {
    appendVary(headers, "Access-Control-Request-Method");
    appendVary(headers, "Access-Control-Request-Headers");
  }

  return response;
}

function appendVary(headers, value) {
  const existing = headers.get("Vary")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];

  if (!existing.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
    existing.push(value);
  }
  headers.set("Vary", existing.join(", "));
}
