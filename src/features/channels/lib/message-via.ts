/**
 * **"VIA" — WHICH OUTSIDE APP WROTE AN OUTSIDE-SESSION POST** (reserved `metadata.via`).
 *
 * An outside session (`desktop-handle.ts › isExternalSessionAuthor`) is any MCP client this product
 * did not spawn. Its post already wears the "outside session" chip; this names the client behind
 * it — "via Claude", "via Claude Code", "via Grok" — from two sources of very different weight:
 *
 *   - **THE CREDENTIAL** (server-read, `server/message-via.ts`): the OAuth app's registered
 *     `client_name` and its redirect URIs. The NAME is self-declared at registration; the
 *     REDIRECT HOSTS are the one verifiable fact — a code is only ever delivered there.
 *   - **`clientInfo`** from the MCP `initialize` request (`shared/auth/mcp-client-info.ts`):
 *     self-declared, always.
 *
 * 🔒 **VERIFIED IS DECIDED IN ONE PLACE — {@link verifiedVendorOf} — AND ONLY FROM REDIRECT
 * HOSTS.** A label is verified only when EVERY redirect URI of the OAuth client is `https` on one
 * allow-listed vendor's domain; the label is then that VENDOR's name, never the client's own.
 * Anything else renders as self-reported. A device token has no redirect, so it is never verified.
 *
 * ⚠ **STAMPED ONLY WHEN THERE IS SOMETHING TO SAY.** A pasted device token whose client sent no
 * `clientInfo` gets no key, and its post keeps the plain "outside session" chip — the honest
 * rendering of "we cannot tell which client this is". There is no "unknown client" label.
 *
 * ⚠ **STALE-PAYLOAD RULE (INVARIANTS §8).** Absent / malformed = "this server did not say", read
 * through {@link viaOf} as `null`, which renders exactly yesterday's chip. Every field is
 * re-scrubbed on READ too: a cached row from any build is untrusted input to the renderer.
 */

import { scrubLabel } from "@/shared/lib/safe-label";
import type { McpClientInfo } from "@/shared/auth/mcp-client-info";

/** Server-owned metadata key. Stripped from caller metadata, re-stamped in `service-writes.ts`. */
export const VIA_METADATA_KEY = "via";

/** Allow-listed vendors, keyed by display name. Subdomains match; look-alikes do not. */
const VERIFIED_VENDORS = {
  Claude: ["claude.ai", "claude.com", "anthropic.com"],
  ChatGPT: ["chatgpt.com", "openai.com"],
  Grok: ["grok.com", "x.ai"],
} as const satisfies Record<string, readonly string[]>;

export type VerifiedVendor = keyof typeof VERIFIED_VENDORS;

const isVendor = (v: unknown): v is VerifiedVendor =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(VERIFIED_VENDORS, v);

function vendorOfHost(host: string): VerifiedVendor | null {
  const h = host.toLowerCase();
  for (const [vendor, domains] of Object.entries(VERIFIED_VENDORS)) {
    if (domains.some((d) => h === d || h.endsWith(`.${d}`))) return vendor as VerifiedVendor;
  }
  return null;
}

/**
 * 🔒 **THE ONE VERIFICATION RULE.** The vendor every redirect URI belongs to, or `null`.
 * ⚠ ALL of them, not the first: a client registering `[https://claude.ai/cb, http://localhost/cb]`
 * can take its code at localhost, so one foreign URI voids the claim. Non-`https`, unparsable or
 * mixed-vendor lists are `null`.
 */
export function verifiedVendorOf(redirectUris: readonly string[] | null | undefined): VerifiedVendor | null {
  if (!redirectUris || redirectUris.length === 0) return null;
  let vendor: VerifiedVendor | null = null;
  for (const uri of redirectUris) {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      return null;
    }
    if (url.protocol !== "https:") return null;
    const v = vendorOfHost(url.hostname);
    if (!v || (vendor && v !== vendor)) return null;
    vendor = v;
  }
  return vendor;
}

/** What `metadata.via` holds. Every field optional; at least one of vendor/app/client is set. */
export interface ViaStamp {
  /** Present ⇔ verified ({@link verifiedVendorOf}). */
  vendor?: VerifiedVendor;
  /** The OAuth client's registered `client_name` (self-declared). OAuth apps only. */
  app?: string;
  /** The OAuth client's first redirect host, for the tooltip. OAuth apps only. */
  host?: string;
  /** The MCP `initialize` clientInfo (self-declared). */
  client?: McpClientInfo;
}

const APP_MAX = 64;
const HOST_MAX = 253;

/**
 * Build the stamp. `null` when there is nothing to say (see the header). Pure: the server half
 * (`server/message-via.ts`) does the read and decides WHEN; this decides WHAT.
 */
export function buildViaStamp(input: {
  credentialKind: "device" | "oauth-app";
  clientName: string | null;
  redirectUris: readonly string[] | null;
  redirectHost: string | null;
  clientInfo: McpClientInfo | null | undefined;
}): ViaStamp | null {
  const oauth = input.credentialKind === "oauth-app";
  const vendor = oauth ? verifiedVendorOf(input.redirectUris) : null;
  // ⚠ A device token's `client_name` is the MACHINE's label, not an app: never shown as one.
  const app = oauth ? scrubLabel(input.clientName, APP_MAX) : null;
  const host = oauth ? scrubLabel(input.redirectHost, HOST_MAX) : null;
  const client = input.clientInfo ?? null;
  if (!vendor && !app && !client) return null;
  return {
    ...(vendor && { vendor }),
    ...(app && { app }),
    ...(host && { host }),
    ...(client && { client }),
  };
}

/** Pretty names for well-known `clientInfo.name`s that send no `title`. Still self-declared. */
const KNOWN_CLIENTS: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-ai": "Claude",
  "codex-mcp-client": "Codex",
  codex: "Codex",
  "cursor-vscode": "Cursor",
  cursor: "Cursor",
};

/** The renderer's view: the chip label, whether it is verified, and the tooltip line. */
export interface MessageVia {
  label: string;
  verified: boolean;
  detail: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Read `metadata.via` → {@link MessageVia}, or `null` ("server did not say" — render the plain
 * outside-session chip). Tolerant: junk fields are dropped, never trusted.
 */
export function viaOf(metadata: Record<string, unknown> | null | undefined): MessageVia | null {
  const raw = metadata?.[VIA_METADATA_KEY];
  if (!isObject(raw)) return null;
  const vendor = isVendor(raw.vendor) ? raw.vendor : null;
  const app = scrubLabel(raw.app, APP_MAX);
  const host = scrubLabel(raw.host, HOST_MAX);
  const c = isObject(raw.client) ? raw.client : null;
  const clientName = scrubLabel(c?.name, APP_MAX);
  const clientTitle = scrubLabel(c?.title, APP_MAX);
  const clientVersion = scrubLabel(c?.version, 32);

  const label =
    vendor ??
    clientTitle ??
    (clientName ? KNOWN_CLIENTS[clientName.toLowerCase()] : undefined) ??
    app ??
    clientName;
  if (!label) return null;

  const client = clientName ? [clientName, clientVersion].filter(Boolean).join(" ") : null;
  const detail = vendor
    ? [host, client].filter(Boolean).join(" · ")
    : [client ?? app, "self-reported"].filter(Boolean).join(" · ");
  return { label, verified: vendor !== null, detail };
}
