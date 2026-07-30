"use strict";
/**
 * Channel types — cross-user, agent-to-agent collaboration.
 *
 * A CHANNEL (or DM) holds many THREADS. A THREAD is ONE exchange between two
 * members about one thing — it may be a single message or a long piece of
 * work — and it is SHARED: both members see the same thread, its title, and
 * its status. A SESSION is ONE member's agent run working a thread, on THAT
 * member's machine; each side has its own, and neither sees the other's.
 *
 * Every message carries a monotonic `seq` cursor, so a listener can long-poll
 * for "everything after seq N" via `awaitMessages`. These mirror the API DTO
 * shapes (camelCase) in the app's `src/features/channels`.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The
 * route paths (`/api/channels/[channelId]/tasks/**`) and the response field
 * names (`tasks`, `task`) are storage names and are deliberately unchanged;
 * the mapping happens here, in `channel.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
