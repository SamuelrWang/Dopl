/**
 * factory.ts — side-effect-free entry for constructing a Dopl MCP server.
 *
 * Importable by BOTH the stdio binary (`index.ts`) and the remote HTTP
 * route in the web app, WITHOUT triggering `main()`, `process.argv`
 * parsing, or a stdio transport. The stdio-specific bits (arg parsing,
 * config-file workspace resolution, orphan-skill cleanup) stay in
 * `index.ts`; everything transport-agnostic lives here.
 */
import type { DoplClient } from "@dopl/client";
import { createServer } from "./server.js";
export { createServer, SERVER_INSTRUCTIONS } from "./server.js";
export { clientIdentifier, packageVersion } from "./version.js";
/** The concrete MCP server type, without importing the SDK type directly. */
export type DoplMcpServer = ReturnType<typeof createServer>;
export interface BootOptions {
    /**
     * OAuth scopes granted for this session, if any. Stage 3 (OAuth) gates
     * write/admin tools on these; absent ⇒ full access (stdio + bearer key).
     */
    scopes?: string[];
    /**
     * Retry attempts for the initial status ping. Default 0 (single attempt —
     * fast for per-request HTTP). The stdio binary passes a few retries because
     * it boots once and tolerates a cold backend.
     */
    pingRetries?: number;
    /**
     * Sink for boot diagnostics (status-ping / canvas-handshake failures).
     * The stdio binary passes `console.error` so a bad key or unreachable
     * backend surfaces at boot; the per-request HTTP route can omit it (or
     * route to its own logger) to avoid log spam on every request. Default: no-op.
     */
    onDiag?: (message: string) => void;
}
export interface BootResult {
    server: DoplMcpServer;
    /** Authenticated user id from the status ping (null if the ping failed). */
    userId: string | null;
    isAdmin: boolean;
    /** Resolved active canvas, for the caller to log/report. Null if unresolved. */
    activeWorkspace: {
        id: string;
        name: string;
        slug: string;
        role: string;
    } | null;
}
/**
 * Build a fully-registered MCP server for `client`: run the status-ping
 * handshake (admin flag + liveness), resolve the active workspace, and
 * register all tools. Transport-agnostic — the caller attaches stdio or
 * HTTP afterward.
 */
export declare function bootServer(client: DoplClient, opts?: BootOptions): Promise<BootResult>;
