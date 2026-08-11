"use strict";
/**
 * Members / teams / access types — read-only mirrors of the workspace
 * membership API shapes (src/features/members/types.ts and
 * src/features/teams/types.ts in the app).
 *
 * `resourceType` is intentionally a plain string: the grant table both grows
 * new resource kinds and keeps retired ones (knowledge_base, skill, chat,
 * chat_folder, the long-dead `workflow`, …), and a read client should render
 * an unknown kind, not reject it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
