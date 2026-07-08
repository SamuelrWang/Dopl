"use strict";
/**
 * Members / teams / access types — read-only mirrors of the workspace
 * membership API shapes (src/features/members/types.ts and
 * src/features/teams/types.ts in the app).
 *
 * `resourceType` is intentionally a plain string: the grant table keeps
 * growing new resource kinds (knowledge_base, workflow, chat,
 * chat_folder, …) and a read client should render unknown kinds, not
 * reject them.
 */
Object.defineProperty(exports, "__esModule", { value: true });
