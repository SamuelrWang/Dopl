/**
 * Agent-template method group — link 9 of the chain in `client-base.ts`
 * (`BillingMethods` extends this one). Pure delegation to `agent-templates.ts`;
 * no HTTP here.
 *
 * `GET`/`POST /api/agent-templates` and `GET`/`PATCH .../{id}` are all
 * agent-token reachable by design (the route docblocks carry the argument);
 * only `DELETE` is `sessionOnly`, and it is deliberately unbound.
 */

import { SkillMethods } from "./client-skills.js";
import * as templates from "./agent-templates.js";
import type {
  AgentTemplate,
  AgentTemplateCreateInput,
  AgentTemplateListPayload,
  AgentTemplateUpdateInput,
  TemplateShelf,
} from "./agent-template-types.js";

export class AgentTemplateMethods extends SkillMethods {
  listAgentTemplates(
    opts: { shelf?: TemplateShelf } = {}
  ): Promise<AgentTemplate[]> {
    return templates.listAgentTemplates(this.transport, opts);
  }

  /** The rows PLUS the shelf sibling key. ⚠ Same single request; read
   *  `homeScopedTemplateIds` as `?? []` (INVARIANTS §8). */
  listAgentTemplatesPayload(
    opts: { shelf?: TemplateShelf } = {}
  ): Promise<AgentTemplateListPayload> {
    return templates.listAgentTemplatesPayload(this.transport, opts);
  }

  getAgentTemplate(templateId: string): Promise<AgentTemplate> {
    return templates.getAgentTemplate(this.transport, templateId);
  }

  createAgentTemplate(input: AgentTemplateCreateInput): Promise<AgentTemplate> {
    return templates.createAgentTemplate(this.transport, input);
  }

  updateAgentTemplate(
    templateId: string,
    patch: AgentTemplateUpdateInput
  ): Promise<AgentTemplate> {
    return templates.updateAgentTemplate(this.transport, templateId, patch);
  }
}
