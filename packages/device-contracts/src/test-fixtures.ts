/** Valid sample objects for the device-sdk tests (not exported from the barrel). */
import { expect } from "vitest";
import type { z } from "zod";

import type { Device } from "./capabilities";

/** parse → equal, and JSON-serialise → parse → equal: the wire shape survives both ways. */
export function expectRoundTrip<S extends z.ZodType>(schema: S, value: z.input<S>): void {
  const parsed = schema.parse(value);
  expect(parsed).toEqual(value);
  expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(value);
}

export const NOW = "2026-10-27T12:00:00.000Z";

export const G2_DEVICE: Device = {
  id: "dev_123",
  kind: "glasses",
  vendor: "even_realities",
  model: "even_g2",
  firmware: "1.4.2",
  adapter_id: "even_g2",
  adapter_version: "0.3.0",
  capabilities: [
    {
      capability: "present.display",
      limits: { width_px: 576, height_px: 248, max_blocks: 12, max_text_bytes: 960, charset: "ascii+box", color: "mono" },
      latency_class: "interactive",
      risk_tier: "T1",
      since_adapter: "even_g2@0.3",
    },
    { capability: "ask.choice", limits: {}, latency_class: "interactive", risk_tier: "T1", since_adapter: "even_g2@0.3" },
  ],
  online: true,
  last_seen_at: NOW,
};
