/**
 * `dopl_skill` READ op handlers: list (active + caller-visible, grouped by
 * folder), get (resolved detail + reference availability), read (SKILL.md plus
 * its Version token). Non-mutating. Routed from the registrar in `skills.ts`.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opList(client: DoplClient, folder?: string): Promise<ToolResponse>;
export declare function opGet(client: DoplClient, slug: string, detail?: "summary" | "full", callerUserId?: string | null): Promise<ToolResponse>;
export declare function opRead(client: DoplClient, slug: string, callerUserId?: string | null): Promise<ToolResponse>;
