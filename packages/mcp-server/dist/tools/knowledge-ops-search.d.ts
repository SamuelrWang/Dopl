/**
 * `dopl_kb(op="search")` — the base-scoped entry search, split out of
 * `knowledge-ops-read.ts` for the 500-line cap (2026-09-18).
 *
 * ⚠ **THE SEAM IS THE SUBJECT.** Everything left behind renders a STRUCTURE the
 * caller already knows the address of (a base list, a tree, a directory, one
 * document); this answers "where does X live" and is the only read op whose
 * result is a RANKING. That difference is why its scope note has to disclose
 * three invisible reductions the others do not have.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opSearch(client: DoplClient, query: string, base?: string, limit?: number): Promise<ToolResponse>;
