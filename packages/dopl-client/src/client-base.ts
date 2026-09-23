/**
 * The first link of `DoplClient`'s method-group chain (construction and transport accessors only).
 * Each `client-<domain>.ts` extends the previous link so every file stays under the 500-line cap while
 * `DoplClient` stays one class. The whole order, written only here:
 *
 *   DoplClientBase → WorkspaceMethods → KnowledgeMethods → OntologyMethods → ChatMethods →
 *   MemberMethods → ChannelMethods → SkillMethods → AgentIdentityMethods → HomeMethods →
 *   BillingMethods → DoplClient (`client.ts`)
 *
 * Order carries no meaning: a link may use only `this.transport`, never a sibling's methods.
 */

import { DoplTransport } from "./transport.js";

export class DoplClientBase {
  /** Protected, not private: every method group in the chain reads it. */
  protected transport: DoplTransport;

  constructor(
    baseUrl: string,
    apiKey: string,
    opts: ConstructorParameters<typeof DoplTransport>[2] = {}
  ) {
    this.transport = new DoplTransport(baseUrl, apiKey, opts);
  }

  getBaseUrl(): string {
    return this.transport.getBaseUrl();
  }

  /** Active canvas. Set → every request carries `X-Workspace-Id`. Null clears. */
  setWorkspaceId(workspaceId: string | null): void {
    this.transport.setWorkspaceId(workspaceId);
  }

  getWorkspaceId(): string | null {
    return this.transport.getWorkspaceId();
  }
}
