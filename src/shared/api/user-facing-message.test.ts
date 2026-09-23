/**
 * THE copy rule for an error on screen: a raw error string never renders.
 */

import { describe, expect, it } from "vitest";
import {
  ApiError,
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  NetworkError,
} from "./api-envelope";
import { userFacingMessage } from "./user-facing-message";

describe("userFacingMessage", () => {
  it("never renders Electron's wrapper text", () => {
    const raw = new Error(
      "Error invoking remote method 'dopl:api-request': TypeError: fetch failed"
    );
    expect(userFacingMessage(raw)).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingMessage(raw)).not.toContain("invoking remote method");
  });

  it("a network failure reads as can't-reach", () => {
    expect(userFacingMessage(new NetworkError())).toBe(NETWORK_ERROR_MESSAGE);
    expect(userFacingMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR_MESSAGE);
    const rewrap = Object.assign(new Error("x"), { status: 0, code: "NETWORK_UNAVAILABLE" });
    expect(userFacingMessage(rewrap, "Couldn't save")).toBe(NETWORK_ERROR_MESSAGE);
  });

  it("keeps a server 4xx's own wording — it is designed copy", () => {
    expect(userFacingMessage(new ApiError(409, "TAKEN", "That name is taken"))).toBe(
      "That name is taken"
    );
    const featureError = Object.assign(new Error("You cannot claim your own link"), { status: 400 });
    expect(userFacingMessage(featureError)).toBe("You cannot claim your own link");
  });

  it("a 5xx, a bridge failure or a JS error reads as the fallback, else the generic line", () => {
    expect(userFacingMessage(new ApiError(500, "INTERNAL_ERROR", "relation does not exist"))).toBe(
      GENERIC_ERROR_MESSAGE
    );
    expect(userFacingMessage(new ApiError(0, "BRIDGE_FAILURE", "x"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingMessage(new TypeError("undefined is not an object"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingMessage(new Error("boom"), "Couldn't add member")).toBe("Couldn't add member");
    expect(userFacingMessage("a string")).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingMessage(null)).toBe(GENERIC_ERROR_MESSAGE);
  });

  it("the decoder's bodiless placeholder is not copy", () => {
    expect(userFacingMessage(new ApiError(404, "INTERNAL_ERROR", "Request failed (404)"))).toBe(
      GENERIC_ERROR_MESSAGE
    );
  });

  it("the copy is short: a label, no explainer", () => {
    expect(GENERIC_ERROR_MESSAGE).toBe("Dopl ran into a problem.");
    expect(NETWORK_ERROR_MESSAGE).toBe("Can't reach Dopl.");
  });
});
