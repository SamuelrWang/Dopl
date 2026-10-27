import type { DocBlock, HttpMethod } from "./types";

/**
 * Pieces every Device SDK page shares. ⚠ The `/v1` surface is PLANNED: the frozen contract is
 * `docs/specs/device-sdk/openapi.yaml` (mirroring `@dopl/contracts/device-sdk`), and
 * `content.test.ts` holds every `/v1` path in a code sample to a path in that file.
 */

/** The planned host (`openapi.yaml › servers`). Not live yet. */
export const API = "https://api.usedopl.com/v1";

/** The first block of every page that describes the unbuilt Device SDK. */
export const PLANNED: DocBlock = {
  type: "quote",
  text: "Planned. This describes the Device SDK, which is in development and not live yet. Today, agents reach devices through the [hosted MCP server](/docs/sdks/hosted-mcp).",
};

/** A cURL request against the planned host with a test secret key. */
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

/** A G2 shaped device, as `openapi.yaml › Device` describes it. Reused across examples. */
export const EXAMPLE_DEVICE = {
  id: "dev_g2_01",
  kind: "glasses",
  vendor: "even_realities",
  model: "g2",
  firmware: null,
  adapter_id: "even_g2",
  adapter_version: "0.1.0",
  capabilities: [],
  online: true,
  last_seen_at: "2026-10-27T17:02:19Z",
};
