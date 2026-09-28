import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import type { Clock } from "../clock";
import { DEVICE_NAME_MAX, listDevices, revokeDevice, updateDevice, type ChannelLinker } from "./service";
import type { DeviceStore } from "./types";
import { claimPairing } from "./pairing";

/**
 * The signed-in user's glasses API (`/api/glasses/pair/claim`,
 * `/api/glasses/devices*`). The routes wrap these in `withUserAuth`; every
 * credential-minting or -changing route is session-only
 * (`session-policy.ts › glassesSessionOnly`), so an agent token can list
 * devices but not pair, relink, revoke or mint a key.
 */

export interface UserHandlerDeps extends Clock {
  devices: DeviceStore;
  linker: ChannelLinker;
  /** Per-user limiter for claims (codes are guessable in principle); true = within. */
  allowClaim: (userId: string) => Promise<boolean>;
}

export const CLAIM_RPM = 10;

const Name = z.string().trim().min(1).max(DEVICE_NAME_MAX);
const ClaimSchema = z.object({
  code: z.string().min(1).max(16),
  name: Name.optional(),
  channel_id: z.string().uuid().nullable().optional(),
});
const PatchSchema = z
  .object({ name: Name.optional(), channel_id: z.string().uuid().nullable().optional() })
  .refine((v) => v.name !== undefined || v.channel_id !== undefined, { message: "Send name and/or channel_id." });

const fail = (err: unknown) => toHttpErrorResponse("glasses", err);

export function createUserHandlers(deps: UserHandlerDeps) {
  return {
    async claim(request: Request, userId: string): Promise<Response> {
      try {
        if (!(await deps.allowClaim(userId))) {
          throw new HttpError(429, "RATE_LIMITED", "Too many pairing attempts; try again in a minute.");
        }
        const input = await parseJson(request, ClaimSchema);
        const device = await claimPairing(deps, userId, input);
        return NextResponse.json({ device }, { status: 201 });
      } catch (err) {
        return fail(err);
      }
    },

    async list(userId: string): Promise<Response> {
      try {
        return NextResponse.json(await listDevices(deps, userId));
      } catch (err) {
        return fail(err);
      }
    },

    async patch(request: Request, userId: string, id: string): Promise<Response> {
      try {
        const patch = await parseJson(request, PatchSchema);
        return NextResponse.json({ device: await updateDevice(deps, userId, id, patch) });
      } catch (err) {
        return fail(err);
      }
    },

    async revoke(userId: string, id: string): Promise<Response> {
      try {
        return NextResponse.json(await revokeDevice(deps, userId, id));
      } catch (err) {
        return fail(err);
      }
    },
  };
}
