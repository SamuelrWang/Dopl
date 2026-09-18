"use strict";
/**
 * Domain types for the SDK's HOME methods — `getHomeChannels` and
 * `createHomeChannel`, both of which address `/api/channels?scope=account`.
 *
 * 🔒 **THE HAND-WRITTEN `HomeChannel` MIRROR IS RETIRED (R-26 (b), 2026-09-17).**
 * It mirrored a 15-field SECOND answer to *"which channels am I in and what is
 * their state"*, off a second route into a second cache; the server deleted all
 * three. The row is `channel-types.ts › Channel` now — the mirror this package
 * already had — so `getHomeChannels` and `listChannels` answer the same shape.
 * `HomePeer` went with it and `HomePendingLink` keeps the server's own name,
 * {@link ChannelPendingLink}.
 *
 * ⚠ **HAND-SYNCED, AND NO DRIFT GATE COVERS IT** — both halves move in ONE change.
 * So it mirrors what a consumer READS, never the whole server type: the four other
 * fields R-26 put on the row (`myWorkspaceRole`, `peers`, `mentionCount`,
 * `linkOut`) are deliberately NOT mirrored, and **their absence means "no SDK
 * caller reads this yet", never "the server does not send it"**.
 *
 * ⚠ **THE METHOD NAMES SAY "HOME" AND THE SCOPE NO LONGER DOES.** `scope=account`
 * answers every container of every kind, which is why `types.ts › ChannelContainer`
 * IS mirrored: it is the only field that tells a home channel from a workspace one,
 * and the filter is the POSITIVE `container?.kind === "link"` (§4A, F-564). The
 * names are kept because `client-surface.test.ts` pins the published method list by
 * name; renaming is a separate argument from repointing.
 *
 * ⚠ **THE OLD HEADER CALLED THIS TYPE "THE CONTAINER DOOR" AND THAT CLAIM IS DEAD.**
 * B10 stopped `GET /api/workspaces` filtering containers out of its listing, so
 * **the door is `listWorkspaces()`** — which is why retiring the row type costs the
 * MCP package nothing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
