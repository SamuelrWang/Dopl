/**
 * `dopl_agent` READ op handlers: list, get. Non-mutating — they resolve a
 * template ref (or a shelf) and render it. Routed from the registrar in
 * `agent.ts`.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
/**
 * ⚠ **THE `shelf` ARGUMENT AND ITS `· personal` LABEL LEFT ON 2026-09-02**
 * (slice B15, ruling B10) — the twin of `dopl_kb(op="list_bases")`'s, for the
 * same reason: a personal template is an ordinary row in the caller's own
 * `kind='personal'` CONTAINER, so "which shelf" is the tenancy the call is
 * already in.
 *
 * 🔒 **AND THE ARGUMENT THAT RETIRED THE LABEL STOPPED BEING TRUE ON 2026-09-06**
 * (invariant 4 of #1077, closed here 2026-09-18). `personal-container.ts ›
 * resolveShelfScope` widened an UNFILTERED read to the calling container PLUS
 * the caller's own personal one, so this list has held rows from TWO tenancies
 * since that day while its heading still said "Private to you" over all of them
 * — one undifferentiated bucket spanning both destinations. **The container is
 * the first axis now**, off the `homeScopedTemplateIds` sibling key this op used
 * to discard, and the visibility axis only ever splits what is left.
 */
export declare function opList(client: DoplClient, 
/** ⚠ OPTIONAL — see `container-destination.ts ›
 *  resolveHomeChannelContainer`: absent means "not known", and the list falls
 *  back to the workspace's own visibility headings. */
directory?: WorkspaceDirectory): Promise<ToolResponse>;
export declare function opGet(client: DoplClient, ref: string, callerUserId?: string | null, 
/** A16: clip the INSTRUCTIONS body, and SAY so. */
maxChars?: number): Promise<ToolResponse>;
