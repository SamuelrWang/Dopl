/**
 * Home-surface method group — link 10 of the chain in `client-base.ts`
 * (`BillingMethods` extends this one). Pure delegation to `home.ts`; no HTTP
 * here.
 *
 * ⚠ TWO METHODS, and the omissions are the point — link MINT, link REVOKE and
 * the CLAIM are all `sessionOnly`, so none of them is bound. See `home.ts`.
 */
import { AgentTemplateMethods } from "./client-agent-templates.js";
import type { HomeChannelCreateResult, HomeChannelsPayload } from "./home-types.js";
export declare class HomeMethods extends AgentTemplateMethods {
    getHomeChannels(): Promise<HomeChannelsPayload>;
    createHomeChannel(input: {
        name: string;
    }): Promise<HomeChannelCreateResult>;
}
