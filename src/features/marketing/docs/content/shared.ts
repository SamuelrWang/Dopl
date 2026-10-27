import type { DocBlock, HttpMethod } from "./types";

/**
 * Pieces every Device SDK page shares. ⚠ The `/v1` routes are BUILT on master (A1–A7) but NOT
 * DEPLOYED, so every page that uses them stays `coming_soon`. The contract is
 * `docs/specs/device-sdk/openapi.yaml` (mirroring `@dopl/contracts/device-sdk`), and
 * `content.test.ts` holds every `/v1` path in a code sample to a path in that file.
 */

/**
 * The base URL the built routes answer on (`src/app/api/v1/*`), which is also `@dopl/sdk`'s default
 * (`packages/sdk/src/http.ts › DEFAULT_BASE_URL`). ⚠ `openapi.yaml › servers` still names the
 * planned `api.usedopl.com/v1`; that host needs DNS and a rewrite (a Samuel-owned item).
 */
export const API = "https://www.usedopl.com/api/v1";

/** The first block of every page that describes the Device SDK, which is built but not deployed. */
export const PLANNED: DocBlock = {
  type: "quote",
  text: "Coming soon. The Device SDK is built and in testing with design partners, and is not live in production yet. Today, agents reach devices through the [hosted MCP server](/docs/sdks/hosted-mcp).",
};

/** A cURL request against the API with a test secret key. */
export function curl(method: HttpMethod, path: string, body?: string): string {
  const lines = [
    `curl --request ${method} \\`,
    `  --url ${API}${path} \\`,
    `  --header 'Authorization: Bearer sk_test_…'${body ? " \\" : ""}`,
  ];
  if (body) lines.push(`  --header 'Content-Type: application/json' \\`, `  --data '${body}'`);
  return lines.join("\n");
}

/** Pretty JSON for a code tab. */
export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** A simulated glasses device as Connect creates it in test mode (`openapi.yaml › Device`). */
export const EXAMPLE_DEVICE = {
  id: "8b0c6f1e-3d2a-4c51-9a7e-2f4d6b1c9e30",
  kind: "glasses",
  vendor: "dopl",
  model: "simulated_glasses",
  firmware: null,
  adapter_id: "simulator",
  adapter_version: "0.1.0",
  capabilities: [
    {
      capability: "present.notify",
      limits: { title_bytes: 64, body_bytes: 480, max_lines: 5 },
      latency_class: "interactive",
      risk_tier: "T1",
      since_adapter: "simulator@0.1.0",
    },
  ],
  online: true,
  last_seen_at: "2026-10-27T17:02:19Z",
};

/** The device id the examples use (Connect creates devices with uuid ids). */
export const DEVICE_ID = EXAMPLE_DEVICE.id;
