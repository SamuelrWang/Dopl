"use strict";
/**
 * RESOURCE GRANTS — the wire shape of `PUT /api/resource-grants`.
 *
 * ⚠ **ONE TABLE, THREE SCOPES, AND TWO LEVEL VOCABULARIES** (Wave B ruling B4,
 * `supabase/migrations/20260914120000_resource_grants.sql`). A CHANNEL grant
 * says which AUDIENCE inside the room may see the row (`agent_only` names no
 * human at all); a CONTAINER or TEAM grant says what the people who already
 * belong to that scope may DO with it. They are not a high/low pair, which is
 * why one column carries both and the DB `CHECK` knows which is which.
 *
 * ⚠ **DECLARED HERE, MIRRORED IN `src/shared/grants/schema.ts`'s zod.** Both are
 * hand-mirrors of the migration's two `CHECK` constraints, which is the only
 * authority — a value legal in one and not the others fails at the statement.
 */
Object.defineProperty(exports, "__esModule", { value: true });
