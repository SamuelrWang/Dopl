/**
 * **THE GRAMMAR STAMP IS WRITTEN AT THE FUNNEL, AND IT CANNOT BE FORGED**
 * (grammar B, 2026-10-12).
 *
 * `metadata.citeMode`'s PRESENCE is what tells a renderer a row was written under
 * grammar B, so its prose numbers are not links; a row without it predates the
 * rule and keeps the legacy `#NNNN` pills it has always had.
 *
 * ⚠ **ABSENCE CANNOT BE FORGED — PRESENCE MUST NOT BE EITHER.** The server always
 * adds the stamp, which is what makes "no stamp = legacy" trustworthy. The
 * failure this file exists to refuse is the other direction: a caller that sets
 * `citeMode` itself, or sets it to a legacy value, must not be able to opt a NEW
 * message back into legacy prose pills. Three inputs, one outcome.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { insertMessage } from "./repository-messages";
import { CITE_MODE_CURRENT, CITE_MODE_METADATA_KEY } from "../lib/cites";

type RpcArgs = { p_metadata: Record<string, unknown> };

const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { id: "m-1", seq: 1 }, error: null });
  vi.mocked(supabaseAdmin).mockReturnValue({ rpc } as never);
});

/** The metadata that actually reached the RPC. */
async function metadataSentFor(
  metadata: Record<string, unknown>
): Promise<Record<string, unknown>> {
  await insertMessage({
    channel_id: "chan-1",
    workspace_id: "ws-1",
    author_user_id: "u-1",
    author_kind: "user",
    kind: "message",
    body: "hi",
    metadata,
    client_msg_id: null,
    wake_verdict: null,
    recipient_user_ids: null,
    recipient_agent_ids: null,
    delivery: null,
  });
  return (rpc.mock.calls[0][1] as RpcArgs).p_metadata;
}

describe("every new row is stamped", () => {
  it("stamps the current mode when the caller sent no metadata key", () => {
    // The ordinary post.
    return metadataSentFor({}).then((sent) => {
      expect(sent[CITE_MODE_METADATA_KEY]).toBe(CITE_MODE_CURRENT);
    });
  });

  it("🔒 OVERWRITES a caller-supplied LEGACY value", async () => {
    // The forgery that matters: `citeMode: 1` would claim this new row predates
    // the rule, and its typed `#12` would draw a pill.
    const sent = await metadataSentFor({ [CITE_MODE_METADATA_KEY]: 1 });
    expect(sent[CITE_MODE_METADATA_KEY]).toBe(CITE_MODE_CURRENT);
  });

  it("OVERWRITES a caller-supplied CURRENT value too", async () => {
    /**
     * ⚠ **THIS CASE DOCUMENTS THE RULE'S SHAPE, NOT ITS COVERAGE** (Review 36,
     * 2026-10-12) — and it is unmarked for that reason, while its neighbours
     * carry 🔒.
     *
     * A caller value of `2` is INDISTINGUISHABLE from the server's own, so this
     * assertion stays GREEN under the mutation that makes the stamp forgeable
     * (spreading the server's value first instead of last). I measured that: the
     * legacy and junk cases above are what bite. It is kept because the rule is
     * "the server decides", not "the server decides when it disagrees", and a
     * reader should find that stated — but nobody should count it as protection.
     */
    const sent = await metadataSentFor({ [CITE_MODE_METADATA_KEY]: 2 });
    expect(sent[CITE_MODE_METADATA_KEY]).toBe(CITE_MODE_CURRENT);
  });

  it("🔒 OVERWRITES junk — a string, null, an object", async () => {
    for (const junk of ["1", null, {}, []]) {
      rpc.mockClear();
      const sent = await metadataSentFor({ [CITE_MODE_METADATA_KEY]: junk });
      expect(sent[CITE_MODE_METADATA_KEY]).toBe(CITE_MODE_CURRENT);
    }
  });

  it("🔒 leaves every OTHER metadata key alone", async () => {
    // The stamp is an addition, not a rewrite: the fold above this one has
    // already decided what the row's metadata is.
    const sent = await metadataSentFor({ threadId: "t-1", summary: "s" });
    expect(sent.threadId).toBe("t-1");
    expect(sent.summary).toBe("s");
    expect(sent[CITE_MODE_METADATA_KEY]).toBe(CITE_MODE_CURRENT);
  });
});
