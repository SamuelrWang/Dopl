/**
 * DMP-003's parity manifest, the half `tool-manifest.ts`'s bindings cannot say: product actions
 * (`METHOD[,METHOD] route` under `src/app/api/`) that no granular tool runs, each with its class and
 * reason. Every other action is `covered` by a binding there. `gap` marks an action an agent should
 * have and does not yet — a later wave's backlog, never a ruling.
 */
export type ParityClass = "human-only" | "app-only-destructive" | "machine-local-security" | "not-user-facing" | "gap";
export declare const UNCOVERED_ACTIONS: ReadonlyArray<readonly [action: string, cls: ParityClass, reason: string]>;
