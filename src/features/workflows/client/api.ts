"use client";

import { apiRequest } from "@/shared/api/api-client";
import type { GraphLayout } from "@/shared/graph";
import type {
  NodeContentInput,
  WorkflowDetail,
  WorkflowGraph,
  WorkflowSummary,
} from "./types";

/**
 * Thin browser wrappers over the `/api/workflows/**` routes (ENGINEERING
 * §9 shape). Each maps the raw envelope to the client types in `./types`;
 * the hook layers TanStack caching + optimistic updates on top.
 */

interface WorkflowRowEnvelope {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  step_count: number;
  knowledge_base_count: number;
  skill_count: number;
}

interface WorkflowDetailEnvelope extends WorkflowRowEnvelope {
  graph: WorkflowGraph | null;
  layout?: GraphLayout | null;
}

function toSummary(r: WorkflowRowEnvelope): WorkflowSummary {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    stepCount: r.step_count ?? 0,
    knowledgeBaseCount: r.knowledge_base_count,
    skillCount: r.skill_count,
  };
}

function toDetail(r: WorkflowDetailEnvelope): WorkflowDetail {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    graph: r.graph,
    layout: r.layout ?? {},
  };
}

export async function listWorkflows(workspaceId: string): Promise<WorkflowSummary[]> {
  const { workflows } = await apiRequest<{ workflows: WorkflowRowEnvelope[] }>(
    "/api/workflows",
    { workspaceId }
  );
  return workflows.map(toSummary);
}

export async function getWorkflow(
  workspaceId: string,
  id: string
): Promise<WorkflowDetail> {
  const detail = await apiRequest<WorkflowDetailEnvelope>(`/api/workflows/${id}`, {
    workspaceId,
  });
  return toDetail(detail);
}

export async function createWorkflow(
  workspaceId: string,
  input: { name: string; description?: string | null }
): Promise<WorkflowSummary> {
  const row = await apiRequest<WorkflowRowEnvelope>("/api/workflows", {
    workspaceId,
    method: "POST",
    body: input,
  });
  return toSummary(row);
}

export function updateWorkflow(
  workspaceId: string,
  id: string,
  input: { name?: string; description?: string | null; layout?: GraphLayout }
): Promise<void> {
  return apiRequest(`/api/workflows/${id}`, {
    workspaceId,
    method: "PATCH",
    body: input,
  });
}

export function deleteWorkflow(workspaceId: string, id: string): Promise<void> {
  return apiRequest(`/api/workflows/${id}`, { workspaceId, method: "DELETE" });
}

export async function addStep(
  workspaceId: string,
  workflowId: string,
  input: NodeContentInput & { ref: string; connect_from?: string }
): Promise<string> {
  const { node_id } = await apiRequest<{ node_id: string }>(
    `/api/workflows/${workflowId}/nodes`,
    { workspaceId, method: "POST", body: input }
  );
  return node_id;
}

export function updateStep(
  workspaceId: string,
  workflowId: string,
  nodeId: string,
  input: NodeContentInput
): Promise<void> {
  return apiRequest(`/api/workflows/${workflowId}/nodes/${nodeId}`, {
    workspaceId,
    method: "PATCH",
    body: input,
  });
}

export function removeStep(
  workspaceId: string,
  workflowId: string,
  nodeId: string
): Promise<void> {
  return apiRequest(`/api/workflows/${workflowId}/nodes/${nodeId}`, {
    workspaceId,
    method: "DELETE",
  });
}

export function connectSteps(
  workspaceId: string,
  workflowId: string,
  from: string,
  to: string,
  condition: string
): Promise<void> {
  return apiRequest(`/api/workflows/${workflowId}/edges`, {
    workspaceId,
    method: "POST",
    body: { from, to, condition },
  });
}

export function disconnectSteps(
  workspaceId: string,
  workflowId: string,
  from: string,
  to: string
): Promise<void> {
  return apiRequest(`/api/workflows/${workflowId}/edges`, {
    workspaceId,
    method: "DELETE",
    body: { from, to },
  });
}
