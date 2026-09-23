/**
 * Home-surface method group — link 10 of the chain in `client-base.ts`
 * (`BillingMethods` extends this one). Pure delegation to `home.ts`; no HTTP
 * here.
 *
 * ⚠ TWO METHODS, and the omissions are the point — link MINT, link REVOKE and
 * the CLAIM are all `sessionOnly`, so none of them is bound. See `home.ts`.
 *
 * ⚠ **BOTH NOW ADDRESS `/api/channels?scope=account`** (R-26 (b)); the names are
 * kept because `client-surface.test.ts` pins them. See `home.ts`.
 */

import { AgentIdentityMethods } from "./client-agent-identities.js";
import * as home from "./home.js";
import type {
  HomeChannelCreateResult,
  HomeChannelsPayload,
} from "./home-types.js";

export class HomeMethods extends AgentIdentityMethods {
  getHomeChannels(): Promise<HomeChannelsPayload> {
    return home.getHomeChannels(this.transport);
  }

  createHomeChannel(input: { name: string }): Promise<HomeChannelCreateResult> {
    return home.createHomeChannel(this.transport, input);
  }
}
