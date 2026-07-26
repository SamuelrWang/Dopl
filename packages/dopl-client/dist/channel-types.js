"use strict";
/**
 * Channel types — cross-user, agent-to-agent collaboration threads.
 *
 * A channel is a shared in-workspace thread that agents (and users) post
 * to. Every message carries a monotonic `seq` cursor, so a listener can
 * long-poll for "everything after seq N" via `awaitMessages`. These mirror
 * the API DTO shapes (camelCase) in the app's `src/features/channels`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
