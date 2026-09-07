/**
 * Billing method group — link 11, LAST of the chain in `client-base.ts`;
 * `DoplClient` extends this one. Pure delegation to `billing.ts`; no HTTP here.
 */

import { HomeMethods } from "./client-home.js";
import * as billing from "./billing.js";
import type { CreditConsumeResponse } from "./types.js";

export class BillingMethods extends HomeMethods {
  /**
   * Spend one MCP credit for `workspaceId`. `allowed: false` = the PAYER's own
   * wallet is out of credits this period — the addressed container picks the
   * wallet (`personal` in a home space, the caller's `seat` in a standard
   * workspace), nothing is pooled across a workspace. The caller renders the
   * refusal, this does NOT throw.
   */
  async consumeCredits(workspaceId: string): Promise<CreditConsumeResponse> {
    return billing.consumeCredits(this.transport, workspaceId);
  }
}
