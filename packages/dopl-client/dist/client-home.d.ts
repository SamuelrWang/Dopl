/**
 * Home-surface method group (`BillingMethods` extends this one; chain in `client-base.ts`). Pure
 * delegation to `home.ts`; the method names are pinned by `client-surface.test.ts`.
 */
import { AgentIdentityMethods } from "./client-agent-identities.js";
import type { HomeChannelCreateInput, HomeChannelCreateResult, HomeChannelsPayload } from "./home-types.js";
export declare class HomeMethods extends AgentIdentityMethods {
    getHomeChannels(): Promise<HomeChannelsPayload>;
    createHomeChannel(input: HomeChannelCreateInput): Promise<HomeChannelCreateResult>;
}
