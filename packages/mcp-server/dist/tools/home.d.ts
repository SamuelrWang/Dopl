/**
 * `dopl_home` — THE CALLER'S OWN HOME CHANNELS, and the only surface that hands
 * out the handle every other tool takes as `workspace=` for one.
 *
 * ── WHY IT IS NOT `list_workspaces`, AND WHY IT IS NOT A DOMAIN TOOL ────────
 *
 * A home channel is a hidden `kind='link'` CONTAINER workspace. It is unlistable
 * BY DESIGN: `workspace-directory.ts › getWorkspaceList` filters through
 * `isStandardWorkspace`, and INVARIANTS §4A forbids advertising a container as a
 * workspace anywhere. **Do not loosen that predicate** — it is a positive test
 * precisely so a future `kind` cannot leak into it (F-295), and four consumers
 * share it. This tool answers containers as what they ARE to the operator:
 * home channels, each carrying the container id that addresses it.
 *
 * ⚠ IT REGISTERS ON THE META PATH BUT IS CHARGED (Samuel's ruling Q2 (b),
 * 2026-08-28). Meta, because the domain path injects a `workspace=` argument and
 * this is the tool that makes such an argument answerable — publishing one here
 * would be an argument that can only ever be wrong. Charged, because unlike the
 * two orientation tools it reads content-adjacent data and WRITES. The charge is
 * written explicitly in `registrar.ts › registerMetaTool`, not folded into a
 * shared wrapper.
 *
 * 🔒 THE LOCK. `home-scopes.ts › listHomeChannels` narrows to `lockedTo`; a
 * container-locked session sees exactly the room it is standing in and no
 * evidence that another exists. Reading `client.getHomeChannels()` directly from
 * here would void B3's whole point.
 */
import type { DoplClient } from "@dopl/client";
import type { RegisterMetaTool } from "./respond.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
export declare function registerHomeTool(registerMetaTool: RegisterMetaTool, client: DoplClient, directory: WorkspaceDirectory): void;
