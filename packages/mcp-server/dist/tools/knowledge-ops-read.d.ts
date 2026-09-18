/**
 * `dopl_kb` READ op handlers: list_bases, get_tree, list_dir, read_file,
 * search. All non-mutating — they resolve a base (or the
 * workspace) and render metadata / bodies for the agent. Routed from the
 * registrar in knowledge.ts.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { type ResponseFormat } from "./response-size";
import type { WorkspaceDirectory } from "../workspace-directory";
/**
 * ⚠ **THE `shelf` ARGUMENT AND ITS `· personal` LABEL LEFT ON 2026-09-02
 * (slice B15, ruling B10).** A personal base is no longer a `home_scoped`
 * BOOLEAN inside a shared workspace — it is an ordinary row in the caller's own
 * `kind='personal'` CONTAINER — so "which shelf" stopped being a question this
 * op could ask and became the tenancy the call is already in. Labelling rows
 * that are all in one container is chrome, and F-342's rule (the unfiltered MCP
 * read is the right one) is now the only rule there is.
 *
 * 🔒 **"ALL IN ONE CONTAINER" STOPPED BEING TRUE ON 2026-09-06, AND THE LABEL
 * IS BACK AS A HEADING (2026-09-18).** Gap 1 of #1077 widened
 * `src/shared/tenancy/personal-container.ts › resolveShelfScope` so an
 * UNFILTERED read returns the calling container PLUS the caller's own personal
 * one — two tenancies in one list, under one undifferentiated heading, for
 * twelve days. The container is the FIRST axis now, off the
 * `homeScopedBaseIds` sibling key this op used to discard; the twin correction
 * is `agent-ops-read.ts › opList`.
 */
export declare function opListBases(client: DoplClient, 
/** ⚠ OPTIONAL — see `container-destination.ts ›
 *  resolveHomeChannelContainer`: absent means "not known", so no `channelId`
 *  is sent and the grant split is not attempted. */
directory?: WorkspaceDirectory): Promise<ToolResponse>;
export declare function opGetTree(client: DoplClient, ref: string, entryLimit?: number, entryCursor?: string): Promise<ToolResponse>;
export declare function opListDir(client: DoplClient, ref: string, path?: string): Promise<ToolResponse>;
/**
 * THE OUTLINE OP — every heading in one entry, with what each costs to read.
 *
 * ⚠ **IT IS A READ THAT DELIBERATELY DOES NOT RETURN THE DOCUMENT.** The body
 * is emptied server-side, so an agent deciding WHETHER to read an entry pays a
 * few dozen characters instead of a few thousand. That is the whole trade, and
 * it is why the routing line names this before `read_file`.
 */
export declare function opOutline(client: DoplClient, ref: string, path: string): Promise<ToolResponse>;
/**
 * ⚠ **THREE WAYS TO SPEND LESS ON ONE DOCUMENT, AND THEY COMPOSE IN ONE ORDER.**
 * `section` picks WHAT (server-side — the rest never crosses the wire), then
 * `offset` and `max_chars` pick how much of that to render. A `section` that
 * does not resolve returns the OUTLINE rather than the document, so the retry
 * costs no round trip.
 */
export declare function opReadFile(client: DoplClient, ref: string, path: string, callerUserId?: string | null, format?: ResponseFormat, maxChars?: number, section?: string, offset?: number): Promise<ToolResponse>;
export declare function opSearch(client: DoplClient, query: string, base?: string, limit?: number): Promise<ToolResponse>;
