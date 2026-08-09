/**
 * `dopl_map` — the compact workspace manifest. One call answers "what
 * exists here and where should I look": knowledge bases, skills and
 * ontology clusters, names + one-liners only. The routing entry point —
 * call before drilling into any domain tool.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerMapTool(register: RegisterTool, client: DoplClient): void;
