import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TEST_MAGIC_DEVICE_IDS, type RiskTier } from "@dopl/contracts/device-sdk";
import { describe, expect, it } from "vitest";

import { createEvenG2Adapter } from "@/features/device-sdk/adapters/even-g2";
import { desktopUnavailable } from "@/features/device-sdk/server/device-adapters";
import { createEvenG2Dispatcher, SDK_ASK_TTL_S, SDK_NOTIFY_TTL_S, SDK_SCREEN_TTL_S } from "@/features/device-sdk/server/glasses/even-g2-dispatch";
import { createFakeGlassesStore } from "@/features/glasses/core/testing/fake-store";
import { DOPL_KIND_PROFILES } from "@/features/device-sdk/delivery/default-profiles";
import { capabilitiesFor } from "@/features/device-sdk/delivery/intents";
import { confirmationModeFor, DEFAULT_RATE_LIMIT } from "@/features/device-sdk/delivery/policy";
import { FALLBACK_KIND_ORDER } from "@/features/device-sdk/delivery/router";
import { defaultGranted } from "@/features/device-sdk/server/connect/scopes";

import { DOC_PAGES, getDocPage, pageToMarkdown } from "./index";
import { G2_ASK_DESCRIPTOR, TIER_ROWS } from "./pages-concepts";
import { CATEGORIES, G2_TTL_S } from "./pages-categories";
import { DEFAULT_PROFILE_ROWS, FALLBACK_ORDER, INTENT_ROWS } from "./pages-routing";
import { MCP_TOOL_ROWS, SDK_METHOD_ROWS } from "./pages-sdk-client";
import { API } from "./shared";
import type { DocBlock, DocPage } from "./types";

/**
 * B3: the Device SDK pages against what is BUILT on master — `packages/sdk` (method names, the
 * project MCP tools, the default base URL) and `src/features/device-sdk` (default profiles, the
 * router's fallback order, intents, the consent defaults, the policy and test mode). The contract
 * side (openapi paths, error codes, capability tiers) is `content.test.ts`.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const CLIENT = read("packages/sdk/src/client.ts");
const MCP_SERVER = read("packages/sdk/src/mcp/server.ts");
const HTTP = read("packages/sdk/src/http.ts");

/** `ROUTES` keys in `client.ts`, e.g. `users.deliver`. */
const ROUTE_METHODS = [...CLIENT.matchAll(/^\s+"(\w+\.\w+)": \{ method:/gm)].map((m) => m[1]);
/** The helper methods declared on the `Dopl` class. */
const HELPERS = [...CLIENT.matchAll(/^ {2}(show|notify|ask)\(externalUserId: string/gm)].map((m) => m[1]);
const SDK_METHODS = new Set([...ROUTE_METHODS, ...HELPERS]);

function codeOf(page: DocPage): string[] {
  const walk = (b: DocBlock): string[] => {
    switch (b.type) {
      case "code":
        return b.tabs.map((t) => t.code);
      case "steps":
        return b.items.flatMap((s) => s.blocks.flatMap(walk));
      case "list":
        return b.items.flatMap((it) => (typeof it === "string" ? [] : (it.blocks ?? []).flatMap(walk)));
      default:
        return [];
    }
  };
  return page.blocks.flatMap(walk);
}

describe("docs against @dopl/sdk", () => {
  it("reads the client's methods", () => {
    expect(ROUTE_METHODS.length).toBeGreaterThanOrEqual(9);
    expect(HELPERS.sort()).toEqual(["ask", "notify", "show"]);
  });

  it("only calls SDK methods the client implements", () => {
    let seen = 0;
    for (const page of DOC_PAGES) {
      for (const code of codeOf(page)) {
        for (const m of code.matchAll(/\bdopl\.(\w+(?:\.\w+)?)\(/g)) {
          seen += 1;
          expect(SDK_METHODS.has(m[1]), `${page.slug} calls dopl.${m[1]}`).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(15);
  });

  it("lists every SDK method once on the TypeScript page", () => {
    const listed = SDK_METHOD_ROWS.map(([method]) => method.split("(")[0]);
    expect(listed.sort()).toEqual([...SDK_METHODS].sort());
  });

  it("names exactly the project MCP server's tools", () => {
    const tools = /PROJECT_MCP_TOOLS = \[([^\]]+)\]/.exec(MCP_SERVER)?.[1].match(/"(\w+)"/g)?.map((t) => t.slice(1, -1));
    expect(MCP_TOOL_ROWS.map(([tool]) => tool)).toEqual(tools);
    expect(pageToMarkdown(getDocPage("sdks/project-mcp")!)).toContain("DOPL_API_KEY");
  });

  it("uses the SDK's default base URL", () => {
    expect(HTTP).toContain(`DEFAULT_BASE_URL = "${API}"`);
  });

  it("never tells a reader to install the private package from npm", () => {
    for (const page of DOC_PAGES) {
      expect(pageToMarkdown(page), page.slug).not.toMatch(/(npm (install|i)|yarn add|pnpm add|bun add) @dopl\/sdk/);
    }
  });
});

describe("docs against the built delivery core", () => {
  it("states Dopl's default profiles as default-profiles.ts defines them", () => {
    const rows = Object.values(DOPL_KIND_PROFILES).map((p) => [
      p.match.kind,
      p.id,
      p.output.max_lines ?? null,
      p.output.max_chars ?? null,
      p.output.format,
      typeof p.overflow === "string" ? p.overflow : `send_to ${p.overflow.send_to}`,
    ]);
    expect(DEFAULT_PROFILE_ROWS).toEqual(rows);
    for (const p of Object.values(DOPL_KIND_PROFILES)) expect(p.confirmation?.T4, p.id).toBe("deny");
  });

  it("states the router's fallback order", () => {
    expect(FALLBACK_ORDER).toEqual([...FALLBACK_KIND_ORDER]);
  });

  it("maps each intent to the capabilities intents.ts accepts, in order", () => {
    const caps = (s: string) => [...s.matchAll(/`([a-z]+\.[a-z_]+)`/g)].map((m) => m[1]);
    for (const [intent, text] of INTENT_ROWS) {
      const expected =
        intent === "ask"
          ? [...capabilitiesFor("ask", { options: [{ label: "a" }, { label: "b" }] }), ...capabilitiesFor("ask", { text: "q" })]
          : capabilitiesFor(intent as "message" | "notify" | "display", { text: "x" });
      expect(caps(text), intent).toEqual(expected);
    }
  });

  it("states the consent defaults and T4 policy as built", () => {
    for (const [tier, , ticked] of TIER_ROWS) expect(ticked, tier).toBe(defaultGranted(tier as RiskTier));
    expect(confirmationModeFor("T4", DOPL_KIND_PROFILES.glasses)).toBe("deny");
    expect(TIER_ROWS.find(([t]) => t === "T4")?.[3]).toMatch(/^Denied by default/);
  });

  it("states the default rate limit", () => {
    expect(DEFAULT_RATE_LIMIT).toEqual({ max: 600, windowMs: 60_000 });
    expect(pageToMarkdown(getDocPage("concepts/permissions-and-safety")!)).toContain("600 deliveries and device actions per minute");
  });

  it("shows the G2 descriptor the adapter returns", () => {
    const d = createEvenG2Adapter().describe({} as never).find((x) => x.capability === "ask.choice");
    expect(G2_ASK_DESCRIPTOR).toEqual(d);
  });
});

describe("docs against test mode", () => {
  const md = pageToMarkdown(getDocPage("guides/test-mode")!);

  it("documents every magic id with its error", () => {
    for (const [id, code] of Object.entries(TEST_MAGIC_DEVICE_IDS)) {
      expect(md).toContain(`\`${id}\``);
      expect(md).toContain(`\`${code}\``);
    }
  });

  it("documents no reset route while it is outside the contract", () => {
    for (const page of DOC_PAGES) expect(pageToMarkdown(page), page.slug).not.toMatch(/test\/reset/);
  });

  it("keeps the phones category coming soon", () => {
    expect(getDocPage("devices/phones")?.status).toBe("coming_soon");
  });
});

describe("category badges against the production dispatchers", () => {
  const device = {
    id: "dev_g2",
    kind: "glasses",
    vendor: "even_realities",
    model: "even_g2",
    firmware: null,
    adapter_id: "even_g2",
    adapter_version: "0.1.0",
    capabilities: [],
    online: true,
    last_seen_at: "2026-10-27T17:00:00Z",
  } as const;

  it("delivers every capability the Display glasses page badges Live on Even G2, with the card's own args", async () => {
    const dispatch = createEvenG2Dispatcher({ store: createFakeGlassesStore().store, now: () => Date.parse("2026-10-27T17:00:00Z") });
    const glasses = CATEGORIES.find((c) => c.slug === "display-glasses")!;
    let checked = 0;
    for (const spec of [...glasses.sends, ...glasses.receives]) {
      if (!spec.support.some((s) => s.model === "Even Realities G2" && s.status === "live")) continue;
      if (spec.call === "answer") continue; // the answer settles the ask.choice action sent above
      const res = await dispatch({ ...device } as never, spec.capability, (spec.args ?? {}) as Record<string, unknown>);
      expect(res.status, `${spec.capability}: ${res.error?.message ?? ""}`).not.toBe("failed");
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it("states the G2 lens lifetimes the dispatcher uses", () => {
    expect(G2_TTL_S).toEqual({ notify: SDK_NOTIFY_TTL_S, screen: SDK_SCREEN_TTL_S, ask: SDK_ASK_TTL_S });
  });

  it("badges nothing Live on the desktop, which the API refuses", async () => {
    const res = await desktopUnavailable({ ...device, kind: "desktop" } as never, "present.notify", {});
    expect(res.error?.code).toBe("capability_unsupported");
    const computers = CATEGORIES.find((c) => c.slug === "computers")!;
    for (const spec of [...computers.sends, ...computers.receives]) for (const s of spec.support) expect(s.status).not.toBe("live");
  });
});
