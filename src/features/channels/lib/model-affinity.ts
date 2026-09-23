/**
 * WHICH RUNTIME A MODEL ID BELONGS TO — the identity-compatibility rule, and nothing else
 * (2026-09-21, U7).
 *
 * ⚠ **IT EXISTS BECAUSE AN IDENTITY CARRIES A MODEL AND NO RUNTIME.** `agent_identities.model` is
 * one column and there is no runtime affinity beside it, so a Coder identity authored on Claude
 * carries `claude-sonnet-5` and would be launched under Codex the moment an operator switched the
 * Runtime row. The plan's U7 is explicit about the answer: *"give identities an explicit runtime
 * affinity or treat an identity model as applicable only to its runtime. **Surface incompatibility
 * instead of silently translating model IDs.**"* This module derives the affinity — a model a
 * reported runtime OFFERS belongs to that runtime — and {@link identityModelMismatch} is the
 * sentence the operator reads.
 *
 * ⚠ **THREE ANSWERS, AND "I CANNOT TELL" IS ONE OF THEM** (INVARIANTS §11 — UNKNOWN is not
 * EMPTY). A runtime whose catalog is absent, loading, stale or unavailable cannot say whether it
 * offers an id; that must never render as "it belongs to somebody else", because the operator
 * would be told their own runtime's model is foreign every time a roster read was in flight.
 *
 * ⚠ **A SHAPE CHECK IS NOT A ROSTER CHECK, AND THAT IS WHY THE DESCRIPTOR IS NOT CONSULTED
 * HERE.** Codex declares an OPEN pick rule whose pattern (`main/runtime/codex/models.js ›
 * descriptor.models.pick`) matches `claude-sonnet-5` perfectly well — reading that as "Codex
 * offers it" is exactly how a Claude id reaches a Codex launch. The CATALOG is the only authority
 * on membership, and `model-catalog.ts › catalogFor` has no "else" arm precisely so no runtime
 * can borrow another's list.
 *
 * ⚠ NO HOOK, NO BRIDGE, NO REACT (INVARIANTS §1). The ONE reason this file changes is that the
 * rule for deciding a model's runtime changed.
 */

import {
  catalogFor,
  catalogReady,
  findModel,
  type ModelCatalog,
  type ModelCatalogs,
} from "./model-catalog";
import type { RuntimeDescriptor } from "./runtime-capability";

/**
 * DOES THIS RUNTIME OFFER THIS MODEL? `true` / `false` / `null` for "this build cannot say".
 *
 * ⚠ ONLY A `ready` CATALOG MAY ANSWER `false`. A `stale` one still LABELS an id honestly and may
 * be missing rows the live roster has; calling a model foreign on the strength of a list we have
 * already declared unconfirmed is a guess wearing a measurement's clothes.
 */
export function modelBelongsTo(
  catalog: ModelCatalog | null | undefined,
  modelId: string | null | undefined
): boolean | null {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (!id) return null;
  if (!catalogReady(catalog) || !catalog) return null;
  // ⚠ 2026-09-22: an ALIAS the runtime declares (a legacy stored id) is membership too.
  return findModel(catalog, id) !== null;
}

/**
 * WHICH REPORTED RUNTIME THIS MODEL ID BELONGS TO, or `null` when nothing can say.
 *
 * ⚠ **ONLY A POSITIVE ANSWER COUNTS, AND IT IS THE FIRST ONE IN REGISTRY ORDER.** A runtime that
 * answers `null` is not a candidate and is not evidence against one either. Two runtimes offering
 * one id is not a state any shipped pair produces, and if it ever were, the first is the one the
 * registry would resolve.
 */
function runtimeForModel(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  catalogs: ModelCatalogs | null | undefined,
  modelId: string | null | undefined
): RuntimeDescriptor | null {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (!id) return null;
  for (const d of runtimes) {
    if (modelBelongsTo(catalogFor(catalogs, d.id), id) === true) return d;
  }
  return null;
}

/**
 * IS THIS MODEL SUBMITTABLE ON THIS RUNTIME, INCLUDING WHAT THE OTHER READY CATALOGS KNOW?
 *
 * A selected runtime whose catalog is loading/unavailable cannot prove membership either way,
 * but that does not erase a positive ownership fact from another runtime's ready catalog. This is
 * the runtime-switch race: an operator picks Opus on Claude, switches to Codex while Codex's
 * roster is unavailable, and launches before the roster can answer. The id is unknown TO CODEX,
 * but it is not unknown TO DOPL — Claude's ready catalog already identifies its owner.
 *
 * ⚠ GENUINELY UNKNOWN IDS STILL PASS. The only new refusal is a positive cross-runtime match;
 * absence/loading remains "I cannot tell", preserving the standing unknown-vs-empty contract.
 * ⚠ THE SELECTED CATALOG WINS A POSITIVE MATCH before registry-order ownership is consulted. The
 * shipped catalogs do not overlap, but if a future pair legitimately shares an id, a runtime
 * that explicitly offers it must be allowed to receive it.
 */
export function modelSubmittableForRuntime(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  catalogs: ModelCatalogs | null | undefined,
  selected: RuntimeDescriptor | null | undefined,
  selectedCatalog: ModelCatalog | null | undefined,
  modelId: string | null | undefined
): boolean {
  const membership = modelBelongsTo(selectedCatalog, modelId);
  if (membership === true) return true;
  if (membership === false) return false;
  const owner = runtimeForModel(runtimes, catalogs, modelId);
  return !owner || !selected || owner.id === selected.id;
}

/** What a mismatch is, once one is found. */
export interface ModelMismatch {
  owner: RuntimeDescriptor;
  modelId: string;
  /** One line, in both platforms' OWN labels. ⚠ Dopl renames no vendor (`runtime-copy.ts`). */
  sentence: string;
}

/**
 * THE IDENTITY/CHANNEL MODEL MISMATCH — `null` when there is none.
 *
 * ⚠ **IT STATES THE FACT AND THE CONSEQUENCE, IN ONE SENTENCE** (INVARIANTS §5, minimal copy).
 * Without the consequence the operator reads a silently dropped model as a bug; without the fact
 * they cannot tell which of their two configurations to change.
 */
export function identityModelMismatch(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  catalogs: ModelCatalogs | null | undefined,
  selected: RuntimeDescriptor | null | undefined,
  modelId: string | null | undefined
): ModelMismatch | null {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (!id || !selected) return null;
  const owner = runtimeForModel(runtimes, catalogs, id);
  if (!owner || owner.id === selected.id) return null;
  return {
    owner,
    modelId: id,
    sentence: `${id} is a ${owner.label} model, so it is not used on ${selected.label}.`,
  };
}
