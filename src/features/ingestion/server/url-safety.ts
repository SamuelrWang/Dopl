/**
 * SSRF guard for server-side URL fetches.
 *
 * The ingestion pipeline follows user-supplied URLs. Without this check,
 * an attacker can point us at:
 *   - 169.254.169.254 (AWS/GCP metadata → IAM creds)
 *   - 127.0.0.1 / localhost (internal services, Redis, etc.)
 *   - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (private LAN)
 *   - ::1, fc00::/7, fe80::/10 (IPv6 private)
 *
 * Call `assertPublicHttpUrl(url)` BEFORE any server-side fetch. It:
 *   1. Rejects non-http(s) schemes.
 *   2. Rejects localhost and known metadata hostnames outright.
 *   3. Resolves the hostname via DNS and rejects if ANY returned IP
 *      falls in a private range.
 *
 * Note: DNS rebinding is a real risk — between this check and the fetch,
 * the hostname could re-resolve. The real fix is to fetch by IP and set
 * the Host header, but that breaks SNI. For most ingestion targets
 * (public sites), the DNS check catches the obvious attacks.
 */

import { promises as dns } from "dns";
import { isIP } from "net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  // 0.0.0.0/8 — "this network"
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (AWS/GCP metadata lives here)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 — reserved
  if (a >= 240) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // fc00::/7 unique-local, fe80::/10 link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") ||
      lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4 address
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsafeUrlError(`Unsupported protocol: ${u.protocol}`);
  }

  const hostname = u.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError(`Blocked hostname: ${hostname}`);
  }

  // If the hostname is already a literal IP, validate it directly —
  // no DNS lookup needed.
  const literalFamily = isIP(hostname);
  if (literalFamily === 4) {
    if (isPrivateIPv4(hostname)) {
      throw new UnsafeUrlError(`Blocked private IPv4: ${hostname}`);
    }
    return;
  }
  if (literalFamily === 6) {
    if (isPrivateIPv6(hostname)) {
      throw new UnsafeUrlError(`Blocked private IPv6: ${hostname}`);
    }
    return;
  }

  // Resolve and check every returned address. Reject if ANY is private.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new UnsafeUrlError(
      `DNS resolution failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!addresses.length) {
    throw new UnsafeUrlError(`No addresses resolved for ${hostname}`);
  }

  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIPv4(address)) {
      throw new UnsafeUrlError(
        `Hostname ${hostname} resolves to private IPv4 ${address}`
      );
    }
    if (family === 6 && isPrivateIPv6(address)) {
      throw new UnsafeUrlError(
        `Hostname ${hostname} resolves to private IPv6 ${address}`
      );
    }
  }
}

// Convenience boolean form for callers that just want to branch.
export async function isSafePublicUrl(url: string): Promise<boolean> {
  try {
    await assertPublicHttpUrl(url);
    return true;
  } catch {
    return false;
  }
}
