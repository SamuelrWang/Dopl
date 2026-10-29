import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ opts: null as null | Record<string, unknown>, url: "" }));
vi.mock("node:https", () => ({
  request: (url: string, opts: Record<string, unknown>) => {
    captured.url = url;
    captured.opts = opts;
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (e?: Error) => void };
    req.end = () => {
      // Answer like a server would: a status and a body with a NUL byte, never touching the network.
      const res = new EventEmitter() as EventEmitter & { statusCode: number; destroy: () => void };
      res.statusCode = 204;
      res.destroy = () => {};
      queueMicrotask(() => {
        req.emit("response", res);
        res.emit("data", Buffer.from("ok\u0000"));
        res.emit("end");
      });
    };
    req.destroy = () => {};
    return req;
  },
}));

import { classifyError, httpsTransport } from "./transport";
import { BlockedAddressError, guardedLookup } from "./url-guard";

describe("https transport", () => {
  it("🔒 dials a hostname through guardedLookup, no redirects followed, NUL stripped", async () => {
    const r = await httpsTransport({ url: "https://hooks.example.com/x", headers: { "webhook-id": "msg_1" }, body: "{}" });
    expect(captured.opts?.lookup).toBe(guardedLookup);
    expect(captured.opts?.method).toBe("POST");
    expect(captured.url).toBe("https://hooks.example.com/x");
    expect(r).toMatchObject({ statusCode: 204, error: null, responseBody: "ok" });
  });

  it("🔒 connection errors are reported as a class, never raw text", () => {
    const e = (code: string) => Object.assign(new Error(`raw detail for ${code} on 10.0.0.1:22`), { code });
    expect(classifyError(e("ENOTFOUND"))).toBe("dns_failed");
    expect(classifyError(e("ECONNREFUSED"))).toBe("connect_refused");
    expect(classifyError(e("ECONNRESET"))).toBe("connect_refused");
    expect(classifyError(e("ERR_TLS_CERT_ALTNAME_INVALID"))).toBe("tls_failed");
    expect(classifyError(e("DEPTH_ZERO_SELF_SIGNED_CERT"))).toBe("tls_failed");
    expect(classifyError(e("ETIMEDOUT"))).toBe("timeout");
    expect(classifyError(new BlockedAddressError("x", "10.0.0.1"))).toBe("address_blocked");
    expect(classifyError(new Error("anything else"))).toBe("connect_failed");
  });
});
