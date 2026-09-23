"use strict";
/**
 * Types for the SDK's home methods (`getHomeChannels`, `createHomeChannel`), both on
 * `/api/channels?scope=account`. The row is `channel-types.ts › Channel`; hand-synced with no drift
 * gate, mirroring only what a consumer reads (an unmirrored field is unread, not unsent). The scope
 * answers every container kind: tell a home channel by `container?.kind === "link"` (F-564).
 */
Object.defineProperty(exports, "__esModule", { value: true });
