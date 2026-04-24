import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createApiKey, listApiKeys } from "@/shared/auth/api-keys";

// In-memory IP → failed attempt counter. Resets every 60s.
// Single-process only — on Vercel this is per-lambda-instance, but attackers
// can't easily target a single instance. For stronger guarantees, back with
// Redis or a DB table.
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS_PER_MINUTE = 5;
// Hard cap on map size. An attacker rotating source IPs can't grow this
// past MAX_TRACKED_IPS; oldest entries get evicted.
const MAX_TRACKED_IPS = 10_000;

function evictExpired(): void {
  const now = Date.now();
  for (const [ip, entry] of failedAttempts) {
    if (entry.resetAt < now) failedAttempts.delete(ip);
  }
  // If still over cap, drop the first (oldest-inserted) entries.
  while (failedAttempts.size > MAX_TRACKED_IPS) {
    const firstKey = failedAttempts.keys().next().value;
    if (firstKey === undefined) break;
    failedAttempts.delete(firstKey);
  }
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkAndCountFailure(ip: string): boolean {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    failedAttempts.set(ip, { count: 0, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS_PER_MINUTE) {
    return false;
  }
  return true;
}

function recordFailure(ip: string): void {
  // Opportunistic eviction so the map doesn't grow unbounded.
  if (failedAttempts.size > MAX_TRACKED_IPS) {
    evictExpired();
  }
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    failedAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
  } else {
    entry.count += 1;
  }
}

/**
 * Constant-time secret comparison. Returns false if either side is missing
 * or if lengths differ. Never reveals anything via timing.
 */
function verifyAdminSecret(presented: string | null | undefined): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !presented) return false;

  // timingSafeEqual requires equal-length buffers. Instead of short-circuiting
  // on a length mismatch (which itself leaks via timing), we pad the shorter
  // one and compare lengths afterwards.
  const a = Buffer.from(presented, "utf-8");
  const b = Buffer.from(secret, "utf-8");
  const maxLen = Math.max(a.length, b.length);
  const ap = Buffer.alloc(maxLen);
  const bp = Buffer.alloc(maxLen);
  a.copy(ap);
  b.copy(bp);
  const bufEqual = timingSafeEqual(ap, bp);
  return bufEqual && a.length === b.length;
}

function checkAdminAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  return verifyAdminSecret(token);
}

function unauthorizedResponse(ip: string): NextResponse {
  recordFailure(ip);
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * GET /api/admin/keys — List all API keys (prefix, name, dates).
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkAndCountFailure(ip)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again in a minute." },
      { status: 429 }
    );
  }
  if (!checkAdminAuth(request)) {
    return unauthorizedResponse(ip);
  }

  try {
    const keys = await listApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/keys — Create a new API key.
 * Body: { "name": "My MCP server" }
 * Returns the plaintext key ONCE.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkAndCountFailure(ip)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again in a minute." },
      { status: 429 }
    );
  }
  if (!checkAdminAuth(request)) {
    return unauthorizedResponse(ip);
  }

  try {
    const body = await request.json();
    const name = body?.name;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const result = await createApiKey(name.trim());

    return NextResponse.json(
      {
        id: result.id,
        key: result.key, // Plaintext — shown ONCE
        prefix: result.prefix,
        name: result.name,
        message: "Save this key now — it will not be shown again.",
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
