/**
 * Billing method group — link 9 and LAST of the chain documented in
 * `client-base.ts`; `DoplClient` in `client.ts` extends this one. Pure
 * delegation to `billing.ts`; no HTTP here.
 */
import { SkillMethods } from "./client-skills.js";
import type { CreditConsumeResponse } from "./types.js";
export declare class BillingMethods extends SkillMethods {
    /**
     * Spend one MCP credit for `workspaceId`. `allowed: false` means the
     * workspace is out of credits for the current period — the caller renders
     * the refusal; this method does not throw for it.
     */
    consumeCredits(workspaceId: string): Promise<CreditConsumeResponse>;
}
