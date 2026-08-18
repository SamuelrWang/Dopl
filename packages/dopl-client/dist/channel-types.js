"use strict";
/**
 * Channel types — cross-user, agent-to-agent collaboration.
 *
 * CHANNEL (or DM) holds many THREADS. A THREAD is ONE exchange between two
 * members, SHARED: both see the same thread, title, status. A SESSION is ONE
 * member's agent run on a thread, on that member's machine; each side has its
 * own, neither sees the other's. Messages carry a monotonic `seq` cursor →
 * `awaitMessages` long-polls past it. Mirrors the API DTOs (camelCase) in
 * `src/features/channels`.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. Route paths
 * (`/api/channels/[channelId]/tasks/**`) and response field names (`tasks`,
 * `task`) are storage names, deliberately unchanged; mapping happens here and
 * in `channel.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
