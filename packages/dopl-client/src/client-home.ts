/**
 * Home-surface method group (`BillingMethods` extends this one; chain in `client-base.ts`). Pure
 * delegation to `home.ts`; the method names are pinned by `client-surface.test.ts`.
 */

import { AgentIdentityMethods } from "./client-agent-identities.js";
import * as home from "./home.js";
import type {
  HomeChannelCreateInput,
  HomeChannelCreateResult,
  HomeChannelsPayload,
} from "./home-types.js";

export class HomeMethods extends AgentIdentityMethods {
  getHomeChannels(): Promise<HomeChannelsPayload> {
    return home.getHomeChannels(this.transport);
  }

  createHomeChannel(input: HomeChannelCreateInput): Promise<HomeChannelCreateResult> {
    return home.createHomeChannel(this.transport, input);
  }
}
