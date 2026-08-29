/**
 * Agent-template methods for `DoplClient`. Free functions over
 * `DoplTransport`; the class-side method group is `client-agent-templates.ts`.
 *
 * ⚠ FOUR VERBS AND THE OMISSION IS THE POINT. `DELETE /api/agent-templates/
 * {id}` is `sessionOnly` AND app-only by standing policy (Samuel's ruling Q9,
 * 2026-08-28), so binding it here would publish a method every MCP tool holds
 * and no MCP caller may ever use.
 *
 * ⚠ TEMPLATES ARE ADDRESSED BY UUID, never by slug — the route param validator
 * (`shared/api/agent-template-route.ts › requireTemplateId`) 400s anything
 * else. Name→id resolution is the MCP layer's job
 * (`packages/mcp-server/src/tools/agent-shared.ts`), over the already
 * visibility-filtered list this module returns.
 */

import type { DoplTransport } from "./transport.js";
import type {
  AgentTemplate,
  AgentTemplateCreateInput,
  AgentTemplateListPayload,
  AgentTemplateUpdateInput,
  TemplateShelf,
} from "./agent-template-types.js";

const enc = encodeURIComponent;

/**
 * The templates this caller may SEE, optionally narrowed to one shelf.
 *
 * ⚠ `shelf` ABSENT = BOTH shelves, and that is the pre-existing contract every
 * caller rides. An unrecognised value never reaches here — the MCP arg is an
 * enum and the route answers 400 — so this function never has to decide what a
 * misspelling means.
 */
export async function listAgentTemplatesPayload(
  t: DoplTransport,
  opts: { shelf?: TemplateShelf } = {}
): Promise<AgentTemplateListPayload> {
  const qs = opts.shelf ? `?shelf=${enc(opts.shelf)}` : "";
  return t.request<AgentTemplateListPayload>(`/api/agent-templates${qs}`, {
    toolName: "agent_list_templates",
  });
}

/** The rows alone. ⚠ DELEGATES to {@link listAgentTemplatesPayload} — one HTTP
 *  call either way, and one place that knows the URL. */
export async function listAgentTemplates(
  t: DoplTransport,
  opts: { shelf?: TemplateShelf } = {}
): Promise<AgentTemplate[]> {
  return (await listAgentTemplatesPayload(t, opts)).templates;
}

export async function getAgentTemplate(
  t: DoplTransport,
  templateId: string
): Promise<AgentTemplate> {
  const data = await t.request<{ template: AgentTemplate }>(
    `/api/agent-templates/${enc(templateId)}`,
    { toolName: "agent_get_template" }
  );
  return data.template;
}

export async function createAgentTemplate(
  t: DoplTransport,
  input: AgentTemplateCreateInput
): Promise<AgentTemplate> {
  const data = await t.request<{ template: AgentTemplate }>(
    "/api/agent-templates",
    { method: "POST", body: input, toolName: "agent_create_template" }
  );
  return data.template;
}

export async function updateAgentTemplate(
  t: DoplTransport,
  templateId: string,
  patch: AgentTemplateUpdateInput
): Promise<AgentTemplate> {
  const data = await t.request<{ template: AgentTemplate }>(
    `/api/agent-templates/${enc(templateId)}`,
    { method: "PATCH", body: patch, toolName: "agent_update_template" }
  );
  return data.template;
}
