import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { DEVICE_NAME_MAX, listDevices, revokeDevice, rotateHeyEvenKey, updateDevice } from "./devices-service";
import type { ChannelLinker } from "./devices-service";
import type { DeviceStore } from "./devices-types";
import { claimPairing } from "./pairing-service";

/**
 * Handlers for the signed-in user's glasses API (`/api/glasses/pair/claim`,
 * `/api/glasses/devices*`). The routes wrap these in `withUserAuth`, so a
 * Supabase session and a `dopl_at_` agent token both work; non-GET methods
 * pass that wrapper's write-scope gate. A Hey Even key only lets its holder
 * post to one linked channel as the user, strictly less than `dopl.write`
 * already allows, so rotating it is not session-only.
 */

export interface UserHandlerDeps {
  devices: DeviceStore;
  linker: ChannelLinker;
  /** Per-user limiter for claims (codes are guessable in principle); true = within. */
  allowClaim: (userId: string) => Promise<boolean>;
  now?: () => number;
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

/** The origin the caller reached us on, so a Hey Even URL points where the key works. */
export function arrivalOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${request.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  return new URL(request.url).origin;
}

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

    async rotateHeyEvenKey(request: Request, userId: string, id: string): Promise<Response> {
      try {
        const out = await rotateHeyEvenKey(deps, userId, id, arrivalOrigin(request));
        return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
      } catch (err) {
        return fail(err);
      }
    },
  };
}
