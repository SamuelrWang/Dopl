"use strict";
/**
 * Domain types for AGENT TEMPLATES — persistent agent identities (name,
 * instructions, default model, custom fields, attached knowledge bases) that
 * outlive any session spawned from them.
 *
 * ⚠ Mirrors `src/features/agent-templates/types.ts` — hand-synced, the same way
 * `knowledge-types.ts` mirrors the knowledge feature. On drift the API response
 * is the source of truth. ⚠ No drift GATE covers this pair:
 * `scripts/check-knowledge-type-drift.ts` names four knowledge interfaces and
 * `scripts/check-role-drift.ts` names the role set; neither reaches here, so
 * both halves must move in ONE change.
 */
Object.defineProperty(exports, "__esModule", { value: true });
