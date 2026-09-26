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
 * `/api/glasses/devices*`). The routes wrap these in `withUserAuth`; every
 * credential-minting or -changing route is session-only
 * (`glasses-runtime.ts › glassesSessionOnly`), so an agent token can list
 * devices but not pair, relink, revoke or mint a Hey Even key.
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

/**
 * The public base a Hey Even URL is built on. `GLASSES_API_BASE_URL` first —
 * set it to the canonical host (`https://www.usedopl.com`): `NEXT_PUBLIC_APP_URL`
 * is the apex, which 307s to www, and clients drop `Authorization` across that
 * redirect. Then `NEXT_PUBLIC_APP_URL` in production. Local dev (no config)
 * answers the server's own origin. Never a request header: a spoofed
 * `X-Forwarded-Host` must not steer where a user sends their key.
 */
export function heyEvenBaseUrl(request: Request, env: Record<string, string | undefined> = process.env): string {
  const configured = env.GLASSES_API_BASE_URL || (env.NODE_ENV === "production" ? env.NEXT_PUBLIC_APP_URL : "");
  return (configured || new URL(request.url).origin).replace(/\/+$/, "");
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
        const out = await rotateHeyEvenKey(deps, userId, id, heyEvenBaseUrl(request));
        return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
      } catch (err) {
        return fail(err);
      }
    },
  };
}
