import { z } from "zod";

export const HeartbeatSchema = z.object({
  installId: z.string().uuid(),
  name: z.string().trim().min(1).max(64),
  platform: z.enum(["macos", "windows", "linux"]),
  osVersion: z.string().trim().max(32).optional(),
  appVersion: z.string().trim().max(32).optional(),
  arch: z.string().trim().max(16).optional(),
  status: z.enum(["active", "away", "offline"]),
  tokenId: z.string().uuid().optional(),
  tokenLabel: z.string().trim().min(1).max(120).optional(),
});

/** `PATCH /api/devices/{id}` — null or "" clears the rename. */
export const RenameComputerSchema = z.object({
  name: z.string().trim().max(64).nullable(),
});
