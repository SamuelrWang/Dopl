/**
 * factory.ts — ⚠ side-effect-free entry for constructing a Dopl MCP server.
 * Importable by BOTH the stdio binary (`index.ts`) and the web app's HTTP route
 * WITHOUT triggering `main()`, `process.argv` parsing, or a stdio transport.
 * Keep stdio-specific bits (arg parsing, config-file workspace resolution,
 * orphan-skill cleanup) in `index.ts`.
 */
import type { DoplClient } from "@dopl/client";
import { createServer } from "./server.js";
import { type CallerIdentity } from "./tools/identity.js";
export type { CallerIdentity } from "./tools/identity.js";
export { createServer, buildInstructions } from "./server.js";
export { clientIdentifier, packageVersion } from "./version.js";
/** The concrete MCP server type, without importing the SDK type directly. */
export type DoplMcpServer = ReturnType<typeof createServer>;
export interface BootOptions {
    /**
     * OAuth scopes granted for this session, if any. Stage 3 (OAuth) gates
     * write tools on these; absent ⇒ full access (stdio + bearer key).
     */
    scopes?: string[];
    /**
     * The CONTAINMENT PROFILE this connection is running under, from the
     * `X-Dopl-Tool-Profile` header the TRANSPORT read
     * (`src/shared/auth/tool-profile-header.ts`) — the desktop stamps the profile
     * it already spawned the session under. Threaded verbatim into
     * `createServer`, whose option docblock carries the narrowing-only rule and
     * the hint-not-fence caveat. Absent ⇒ the whole surface; a value this server
     * cannot place ⇒ the narrowest profile, never the widest.
     */
    toolProfile?: string | null;
    /**
     * Retry attempts for the initial status ping. Default 0 — fast for per-request
     * HTTP; the stdio binary passes retries because it boots once.
     */
    pingRetries?: number;
    /**
     * Boot-diagnostics sink. The stdio binary passes `console.error` so a bad key
     * surfaces at boot; the per-request HTTP route omits it to avoid per-request
     * log spam. Default: no-op.
     */
    onDiag?: (message: string) => void;
    /**
     * Who is calling and through what, resolved by the TRANSPORT — the only layer
     * that sees the credential and the request headers. ⚠ When the transport
     * supplies a user id it WINS over the status ping's: it comes from the
     * credential actually authorizing this request, not a second round-trip
     * against a second code path that fails on its own.
     */
    caller?: Partial<CallerIdentity>;
    /**
     * The caller's own live agent handles and the posture this session runs at,
     * when the TRANSPORT knows them. ⚠ Threaded verbatim into the `instructions`
     * briefing (`instructions.ts › ConnectionIdentity`) so an orchestrator does
     * not spend a `dopl_status` call finding its own agents. Absent renders as a
     * pointer to that tool, never as "you have none" — and nothing here costs a
     * loopback, which this function's own docblock forbids.
     */
    liveAgents?: readonly string[];
    posture?: string | null;
}
export interface BootResult {
    server: DoplMcpServer;
    /** Authenticated user id from the status ping (null if the ping failed). */
    userId: string | null;
    isAdmin: boolean;
    /**
     * The container this connection is BOUND to: the request's `X-Workspace-Id`,
     * or null. ⚠ **NULL IS ORDINARY SINCE B13** — a call that names no container
     * is resolved by the SERVER, not refused and not guessed here.
     */
    activeWorkspace: {
        id: string;
        name: string;
        slug: string;
        role: string;
    } | null;
    /**
     * ⚠ True when the boot `listWorkspaces()` FAILED, as distinct from a genuine
     * 0-membership directory — the refusal copy must say "couldn't load, retry",
     * not "you have no workspaces".
     */
    directoryLoadFailed: boolean;
}
/**
 * Build a fully-registered MCP server for `client`: status-ping handshake
 * (admin flag + liveness), resolve the session default workspace, register all
 * tools. Transport-agnostic — the caller attaches stdio or HTTP afterward.
 */
export declare function bootServer(client: DoplClient, opts?: BootOptions): Promise<BootResult>;
