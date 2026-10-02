import { randomUUID } from "crypto";
import { scrubLabel } from "@/shared/lib/safe-label";

/**
 * **WHICH MCP CLIENT IS ON THE OTHER END** — the `clientInfo` an MCP client sends in its
 * `initialize` request (`{ name, title?, version }`), carried to every later request of the same
 * connection so a channel post can say "via Claude Code".
 *
 * ⚠ **SELF-DECLARED, ALWAYS.** Any client can call itself anything; this is a LABEL and gates
 * nothing. What is verifiable about a caller is its OAuth redirect host, decided in
 * `features/channels/lib/message-via.ts › verifiedVendorOf`, never here.
 *
 * ⚠ **WHY IT RIDES THE `Mcp-Session-Id`.** `/api/mcp` is STATELESS (`sessionIdGenerator:
 * undefined`): `initialize` and every `tools/call` are separate requests with nothing in between,
 * so the `clientInfo` seen at `initialize` is gone by the time a tool posts. The spec says a client
 * MUST echo the session id the server returned at `initialize` on every later request, so the
 * route returns one that ENCODES the client info ({@link clientInfoSessionId}) and decodes it back
 * on each request ({@link clientInfoFromSessionId}). No storage, no migration, and it is per
 * CONNECTION — a device token shared by Claude Code and Codex on one machine still tells them
 * apart, which a per-token column could not. The SDK never validates a session id in stateless
 * mode, so the id is never refused; a client that does not echo it simply has no client info.
 *
 * ⚠ The loopback carries it on to `/api/*` as {@link CLIENT_INFO_HEADER}. A direct REST caller can
 * set that header too — which grants exactly what a lying `initialize` grants: a self-reported label.
 */

export interface McpClientInfo {
  /** `clientInfo.name` — the machine name (`claude-code`, `codex-mcp-client`). */
  name: string;
  /** `clientInfo.title` — the display name some clients send (spec 2025-06-18). */
  title?: string;
  version?: string;
}

/** Loopback header carrying the encoded client info from `/api/mcp` to `/api/*`. */
export const CLIENT_INFO_HEADER = "x-dopl-client-info";

const NAME_MAX = 64;
const VERSION_MAX = 32;
const SESSION_PREFIX = "dci1";
/** `initialize` is a few hundred bytes; never tee a large body to look for it. */
const PEEK_MAX_BYTES = 16_384;

/** The one shape check, applied at every boundary the value crosses. Scrubs, clips, drops junk. */
export function narrowClientInfo(raw: unknown): McpClientInfo | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = scrubLabel(r.name, NAME_MAX);
  if (!name) return null;
  const title = scrubLabel(r.title, NAME_MAX);
  const version = scrubLabel(r.version, VERSION_MAX);
  return { name, ...(title && { title }), ...(version && { version }) };
}

/** base64url(JSON) — visible ASCII only, so it is a legal `Mcp-Session-Id` and header value. */
export function encodeClientInfo(info: McpClientInfo): string {
  return Buffer.from(JSON.stringify(info), "utf8").toString("base64url");
}

export function decodeClientInfo(encoded: string | null | undefined): McpClientInfo | null {
  if (!encoded || encoded.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    return narrowClientInfo(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/** `dci1.<uuid>.<payload>` — unique per connection (the spec's SHOULD), carrying the info. */
export function clientInfoSessionId(info: McpClientInfo): string {
  return `${SESSION_PREFIX}.${randomUUID()}.${encodeClientInfo(info)}`;
}

export function clientInfoFromSessionId(sessionId: string | null | undefined): McpClientInfo | null {
  if (!sessionId) return null;
  const parts = sessionId.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_PREFIX) return null;
  return decodeClientInfo(parts[2]);
}

/**
 * The `clientInfo` of an `initialize` request, or `null` for anything else. Reads a CLONE, so the
 * body the transport parses is untouched. ⚠ Never throws: a body this cannot read is simply not an
 * `initialize` it can label.
 */
export async function initializeClientInfo(request: Request): Promise<McpClientInfo | null> {
  if (request.method !== "POST") return null;
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > PEEK_MAX_BYTES) return null;
  try {
    const text = await request.clone().text();
    if (!text.includes('"initialize"')) return null;
    const parsed: unknown = JSON.parse(text);
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const m of messages) {
      if (m && typeof m === "object" && (m as { method?: unknown }).method === "initialize") {
        return narrowClientInfo((m as { params?: { clientInfo?: unknown } }).params?.clientInfo);
      }
    }
  } catch {
    // not JSON / not readable: no label
  }
  return null;
}

/** The loopback header, narrowed — `undefined` when absent or unreadable. */
export function readClientInfoHeader(request: { headers: Headers }): McpClientInfo | undefined {
  return decodeClientInfo(request.headers.get(CLIENT_INFO_HEADER)) ?? undefined;
}
