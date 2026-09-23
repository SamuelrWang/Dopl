"use strict";
/**
 * `PUT /api/resource-grants` wire shape. One table, three scopes, two level vocabularies: a channel
 * grant names an AUDIENCE in the room, a container/team grant what its members may DO. Hand-mirrors
 * the two CHECKs of `20260914120000_resource_grants.sql` (as does `src/shared/grants/schema.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
