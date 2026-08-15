/**
 * Billing method group — link 9, LAST of the chain in `client-base.ts`;
 * `DoplClient` extends this one. Pure delegation to `billing.ts`; no HTTP here.
 */

import { SkillMethods } from "./client-skills.js";
import * as billing from "./billing.js";
import type { CreditConsumeResponse } from "./types.js";

export class BillingMethods extends SkillMethods {
  /**
   * Spend one MCP credit for `workspaceId`. `allowed: false` = out of credits
   * this period; the caller renders the refusal, this does NOT throw.
   */
  async consumeCredits(workspaceId: string): Promise<CreditConsumeResponse> {
    return billing.consumeCredits(this.transport, workspaceId);
  }
}
