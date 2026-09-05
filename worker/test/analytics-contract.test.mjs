import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
  });
}

const ADMIN_ID =
  "11111111-1111-4111-8111-111111111111";
const ALLOWED_ORIGIN =
  "https://pacebrosvisuals.ca";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function summaryReport(values) {
  return {
    metricHeaders: [
      { name: "totalUsers" },
      { name: "newUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "activeUsers" },
      { name: "userEngagementDuration" },
      { name: "eventCount" },
    ],
    rows: [
      {
        metricValues: values.map((value) => ({
          value: String(value),
        })),
      },
    ],
  };
}

async function createServiceAccountJson() {
  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([
        1,
        0,
        1,
      ]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const privateKey = await webcrypto.subtle.exportKey(
    "pkcs8",
    keyPair.privateKey,
  );
  const encoded = Buffer.from(privateKey).toString(
    "base64",
  );
  const wrapped = encoded.match(/.{1,64}/g).join("\n");

  return JSON.stringify({
    type: "service_account",
    private_key_id: "test-key-id",
    private_key:
      `-----BEGIN PRIVATE KEY-----\n${wrapped}\n` +
      "-----END PRIVATE KEY-----\n",
    client_email:
      "pace-bros-test@example.iam.gserviceaccount.com",
  });
}

test(
  "analytics stays admin-only and normalizes GA4 reports",
  async () => {
    const { default: worker } = await import(
      "../src/index.js"
    );
    const serviceAccountJson =
      await createServiceAccountJson();
    const googleCalls = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(
        input instanceof Request
          ? input.url
          : String(input),
      );

      if (url.pathname === "/auth/v1/user") {
        return json({ id: ADMIN_ID });
      }

      if (
        url.pathname === "/rest/v1/admin_users"
      ) {
        return json([{ user_id: ADMIN_ID }]);
      }

      if (url.hostname === "oauth2.googleapis.com") {
        googleCalls.push("oauth");
        const form = new URLSearchParams(
          String(init.body),
        );
        const assertion = form.get("assertion");
        const [, encodedClaims] =
          assertion.split(".");
        const claims = JSON.parse(
          Buffer.from(
            encodedClaims,
            "base64url",
          ).toString("utf8"),
        );

        assert.equal(
          claims.scope,
          "https://www.googleapis.com/auth/analytics.readonly",
        );
        assert.equal(
          claims.aud,
          "https://oauth2.googleapis.com/token",
        );

        return json({
          access_token: "test-google-token",
          expires_in: 3600,
        });
      }

      if (
        url.pathname.endsWith(
          ":runRealtimeReport",
        )
      ) {
        googleCalls.push("realtime");
        assert.equal(
          init.headers.Authorization,
          "Bearer test-google-token",
        );

        return json({
          metricHeaders: [
            { name: "activeUsers" },
            { name: "screenPageViews" },
            { name: "eventCount" },
          ],
          rows: [
            {
              metricValues: [3, 10, 20].map(
                (value) => ({
                  value: String(value),
                }),
              ),
            },
          ],
        });
      }

      if (
        url.pathname.endsWith(
          ":batchRunReports",
        )
      ) {
        googleCalls.push("historical");
        const requestBody = JSON.parse(init.body);

        assert.equal(
          requestBody.requests.length,
          5,
        );

        return json({
          reports: [
            summaryReport([
              5,
              2,
              7,
              11,
              4,
              120,
              30,
            ]),
            summaryReport([
              25,
              8,
              35,
              70,
              20,
              800,
              170,
            ]),
            summaryReport([
              80,
              30,
              100,
              250,
              75,
              4500,
              700,
            ]),
            {
              dimensionHeaders: [
                { name: "pageTitle" },
                { name: "pagePath" },
              ],
              metricHeaders: [
                { name: "screenPageViews" },
              ],
              rows: [
                {
                  dimensionValues: [
                    { value: "Selected Works" },
                    { value: "/" },
                  ],
                  metricValues: [{ value: "50" }],
                },
              ],
            },
            {
              dimensionHeaders: [
                { name: "sessionSource" },
                { name: "sessionMedium" },
              ],
              metricHeaders: [
                { name: "sessions" },
                { name: "totalUsers" },
              ],
              rows: [
                {
                  dimensionValues: [
                    { value: "(direct)" },
                    { value: "(none)" },
                  ],
                  metricValues: [
                    { value: "40" },
                    { value: "25" },
                  ],
                },
              ],
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };

    const baseEnv = {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    };
    const requestHeaders = {
      Origin: ALLOWED_ORIGIN,
      Authorization: "Bearer test-admin-token",
    };

    try {
      const unauthorized = await worker.fetch(
        new Request(
          "https://worker.test/admin/analytics",
          {
            headers: {
              Origin: ALLOWED_ORIGIN,
            },
          },
        ),
        baseEnv,
      );

      assert.equal(unauthorized.status, 401);
      assert.equal(googleCalls.length, 0);

      const unconfigured = await worker.fetch(
        new Request(
          "https://worker.test/admin/analytics",
          { headers: requestHeaders },
        ),
        baseEnv,
      );

      assert.equal(unconfigured.status, 503);
      assert.equal(
        (await unconfigured.json()).error.code,
        "analytics_not_configured",
      );
      assert.equal(googleCalls.length, 0);

      const response = await worker.fetch(
        new Request(
          "https://worker.test/admin/analytics",
          { headers: requestHeaders },
        ),
        {
          ...baseEnv,
          GA4_PROPERTY_ID: "123456789",
          GOOGLE_SERVICE_ACCOUNT_JSON:
            serviceAccountJson,
        },
        {
          waitUntil() {},
        },
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get(
          "Access-Control-Allow-Origin",
        ),
        ALLOWED_ORIGIN,
      );
      assert.equal(
        response.headers.get("Cache-Control"),
        "private, no-store",
      );
      assert.deepEqual(body.realtime, {
        activeUsers: 3,
        views: 10,
        eventCount: 20,
      });
      assert.equal(
        body.today.averageEngagementTimeSeconds,
        30,
      );
      assert.equal(
        body.last30Days.averageEngagementTimeSeconds,
        60,
      );
      assert.deepEqual(body.topContent, [
        {
          title: "Selected Works",
          path: "/",
          views: 50,
        },
      ]);
      assert.deepEqual(body.trafficSources, [
        {
          source: "(direct)",
          medium: "(none)",
          sessions: 40,
          users: 25,
          percentage: 40,
        },
      ]);
      assert.deepEqual(googleCalls.sort(), [
        "historical",
        "oauth",
        "realtime",
      ]);
      assert.equal(
        JSON.stringify(body).includes(
          "PRIVATE KEY",
        ),
        false,
      );

      const cachedResponse = await worker.fetch(
        new Request(
          "https://worker.test/admin/analytics",
          { headers: requestHeaders },
        ),
        {
          ...baseEnv,
          GA4_PROPERTY_ID: "123456789",
          GOOGLE_SERVICE_ACCOUNT_JSON:
            serviceAccountJson,
        },
      );

      assert.equal(cachedResponse.status, 200);
      assert.deepEqual(await cachedResponse.json(), body);
      assert.deepEqual(googleCalls.sort(), [
        "historical",
        "oauth",
        "realtime",
      ]);

      const forbiddenOrigin = await worker.fetch(
        new Request(
          "https://worker.test/admin/analytics",
          {
            headers: {
              Origin: "https://example.com",
              Authorization:
                "Bearer test-admin-token",
            },
          },
        ),
        baseEnv,
      );

      assert.equal(forbiddenOrigin.status, 403);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);
