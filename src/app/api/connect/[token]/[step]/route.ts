import { after, NextResponse, type NextRequest } from "next/server";
import { devSdkError, devSdkErrorCode } from "@/features/device-sdk/server/errors";
import { sessionByToken } from "@/features/device-sdk/server/connect/service";
import { logConnectStep } from "@/features/device-sdk/server/internal-events";
import { claimConnectPairing, consentConnect, startConnectPairing } from "@/features/device-sdk/server/connect/hosted";
import { allowConnectPagePost, answerConnect, connectDeps, readJsonBody } from "@/features/device-sdk/server/connect/runtime";

export const dynamic = "force-dynamic";

/**
 * `POST /api/connect/{token}/{pair|claim|consent}` — the hosted Connect page's steps
 * (`/connect/{token}`). The raw connect token in the path is the ONLY credential: there is no Dopl
 * session (D1), so `/api/connect/` is in `PUBLIC_ROUTES` + `SELF_AUTH_ROUTES`. Per-IP limited.
 * Errors are the C10 shape, like `/v1`.
 */
const STEPS = {
  pair: startConnectPairing,
  claim: claimConnectPairing,
  consent: consentConnect,
} as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string; step: string }> }) {
  const { token, step } = await params;
  const run = Object.prototype.hasOwnProperty.call(STEPS, step) ? STEPS[step as keyof typeof STEPS] : null;
  if (!run) return devSdkError("not_found", "Unknown Connect step.");
  if (!(await allowConnectPagePost(request))) return devSdkError("rate_limited", "Too many requests. Try again in a minute.");
  const started = performance.now();
  const res = await answerConnect(async () => {
    const body = await readJsonBody(request);
    const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return NextResponse.json(await run(connectDeps, token, input));
  });
  const latencyMs = performance.now() - started;
  // The session read happens after the step, so the row names the device and connection it just made.
  const log = async () => {
    const session = await sessionByToken(connectDeps, token).catch(() => null);
    if (session) await logConnectStep({ session, step, status: res.status, code: devSdkErrorCode(res), latencyMs });
  };
  try {
    after(log);
  } catch {
    void log(); // No request scope (a suite driving the handler directly).
  }
  return res;
}
