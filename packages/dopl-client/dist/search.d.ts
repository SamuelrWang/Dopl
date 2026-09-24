/**
 * THE APP'S GLOBAL SEARCH — `GET /api/search`. The same server implementation
 * the search popup calls, so an agent and a person searching one container get one answer.
 *
 * ⚠ THE FENCE IS THE SERVER'S: every read behind the route enters through the caller's own
 * `workspace_members` / `channel_members` rows, a container the caller is not in yields 403, and a
 * container-locked credential is narrowed to its lock (`ctx.apiKeyWorkspaceId`). Nothing here widens
 * or re-states any of it. Hand-mirrors `src/features/search/contracts.ts`; move both halves together.
 */
import type { DoplTransport } from "./transport.js";
export type AppSearchGroupKind = "channels" | "messages" | "threads" | "artifacts" | "knowledge" | "agentIdentities" | "members" | "skills" | "chats";
/** One hit. An optional field is omitted when the kind has no value for it. */
export interface AppSearchItem {
    id: string;
    kind: AppSearchGroupKind;
    title: string;
    subtitle?: string;
    /** Only `<mark>` survives server escaping. */
    snippet?: string;
    containerId: string;
    containerName?: string;
    channelId?: string;
    /** `channel_messages.seq` — the table-wide cursor. */
    seq?: number;
    threadId?: string;
    updatedAt?: string;
}
export interface AppSearchGroup {
    kind: AppSearchGroupKind;
    /** Matches found, capped at 50 (a total AT the cap means "50 or more"). */
    total: number;
    /** At most 8. */
    items: AppSearchItem[];
}
export interface AppSearchResponse {
    q: string;
    scope: "account" | "container";
    tookMs: number;
    /** A group with no items is omitted. */
    groups: AppSearchGroup[];
}
/** One container's search. A query under 2 characters answers with no groups, never a 400. */
export declare function searchContainer(t: DoplTransport, query: string, containerId: string): Promise<AppSearchResponse>;
