import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";

/**
 * SSRF guard for webhook endpoint URLs. Checked TWICE:
 *  1. at register / update (`checkEndpointUrl`): https only, no credentials, and the host must not be
 *     (or resolve to) a private, loopback, link-local, metadata or otherwise non-public address;
 *  2. at send (`guardedLookup`): the sender connects through this DNS lookup, so the address it
 *     actually dials is the one that was checked (no DNS-rebinding window between check and connect).
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 96], // unspecified, loopback and IPv4-compatible (`[::127.0.0.1]`)
  ["::ffff:0:0:0", 96], // IPv4-translated (SIIT)
  ["64:ff9b::", 96], // NAT64 (would reach an embedded IPv4)
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments (Teredo etc.)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local, incl. fd00:ec2::254 metadata
  ["fec0::", 10], // site-local (deprecated, still routed internally on some networks)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** True when `ip` must never be dialled. Non-IP input is blocked. IPv4-mapped IPv6 is checked as IPv4. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(ip, "ipv6");
  }
  return true;
}

export type Resolver = (hostname: string) => Promise<string[]>;

/** Every address `hostname` resolves to (A and AAAA). */
export const resolveAll: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) => {
      if (err) reject(err);
      else resolve(addresses.map((a) => a.address));
    });
  });

export const ENDPOINT_URL_MAX = 2048;
/**
 * Ports an endpoint may use (ruled 2026-10-28): 443 (the https default) and 8443. Anything else would
 * let the sender probe arbitrary services on public hosts.
 */
export const ALLOWED_PORTS: readonly string[] = ["", "443", "8443"];

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/** Syntax-only checks (no DNS): https, no credentials, no fragment, a host, length cap. */
export function parseEndpointUrl(raw: string): UrlCheck {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > ENDPOINT_URL_MAX) {
    return { ok: false, reason: `url must be 1-${ENDPOINT_URL_MAX} characters` };
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "url is not a valid URL" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "url must use https" };
  if (u.username || u.password) return { ok: false, reason: "url must not contain credentials" };
  if (u.hash) return { ok: false, reason: "url must not contain a fragment" };
  if (!ALLOWED_PORTS.includes(u.port)) return { ok: false, reason: "url port must be 443 or 8443" };
  const host = hostOf(u);
  if (!host) return { ok: false, reason: "url has no host" };
  if (isIP(host) && isBlockedAddress(host)) return { ok: false, reason: "url points at a private or reserved address" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "url points at a private host" };
  }
  return { ok: true, url: u.toString() };
}

/** URL hostname without IPv6 brackets or a trailing root dot (`localhost.` is `localhost`). */
export function hostOf(u: URL): string {
  return u.hostname.replace(/^\[(.*)\]$/, "$1").replace(/\.+$/, "").toLowerCase();
}

/** Register-time check: syntax + every resolved address public. */
export async function checkEndpointUrl(raw: string, resolve: Resolver = resolveAll): Promise<UrlCheck> {
  const parsed = parseEndpointUrl(raw);
  if (!parsed.ok) return parsed;
  const host = hostOf(new URL(parsed.url));
  if (isIP(host)) return parsed;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, reason: "url host does not resolve" };
  }
  if (addresses.length === 0) return { ok: false, reason: "url host does not resolve" };
  if (addresses.some(isBlockedAddress)) return { ok: false, reason: "url resolves to a private or reserved address" };
  return parsed;
}

export class BlockedAddressError extends Error {
  readonly code = "EWEBHOOKBLOCKED";
  constructor(host: string, address: string) {
    super(`refusing to connect to ${host}: ${address} is a private or reserved address`);
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `lookup` for `https.request` that refuses blocked addresses: the socket only ever dials an
 * address this function approved. Rejects the whole answer when ANY address is blocked.
 */
export function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number | string } | number | undefined,
  callback: LookupCallback
): void {
  const opts = typeof options === "object" && options !== null ? options : {};
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "");
    const bad = addresses.find((a) => isBlockedAddress(a.address));
    if (bad) return callback(new BlockedAddressError(hostname, bad.address) as NodeJS.ErrnoException, "");
    if (addresses.length === 0) return callback(Object.assign(new Error(`no address for ${hostname}`), { code: "ENOTFOUND" }), "");
    if (opts.all) return callback(null, addresses);
    const first = addresses[0] as LookupAddress;
    callback(null, first.address, first.family);
  });
}
