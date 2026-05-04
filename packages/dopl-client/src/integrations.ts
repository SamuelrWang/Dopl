/**
 * Integration methods for `DoplClient`. Each function takes the
 * shared `DoplTransport` as its first arg and hits the matching
 * Next.js route under `/api/integrations/...`. The `DoplClient`
 * class exposes them as instance methods (mirrors the per-domain
 * split that `knowledge.ts` started).
 */

import type { DoplTransport } from "./transport.js";
import type {
  ConnectResponse,
  IntegrationListResponse,
  IntegrationProvider,
  IntegrationStatusResponse,
  PrepareFromIntegrationResponse,
} from "./integration-types.js";

const enc = encodeURIComponent;

export async function connectIntegration(
  t: DoplTransport,
  provider: IntegrationProvider
): Promise<ConnectResponse> {
  return t.request<ConnectResponse>(
    `/api/integrations/${enc(provider)}/connect`,
    { method: "POST", toolName: "connect_integration" }
  );
}

export async function getIntegrationStatus(
  t: DoplTransport,
  provider: IntegrationProvider
): Promise<IntegrationStatusResponse> {
  return t.request<IntegrationStatusResponse>(
    `/api/integrations/${enc(provider)}/status`,
    { toolName: "integration_status" }
  );
}

export async function listIntegrationObjects(
  t: DoplTransport,
  provider: IntegrationProvider,
  input: { query?: string; cursor?: string; limit?: number } = {}
): Promise<IntegrationListResponse> {
  return t.request<IntegrationListResponse>(
    `/api/integrations/${enc(provider)}/list`,
    {
      method: "POST",
      body: input,
      toolName: "list_integration_objects",
    }
  );
}

export async function prepareFromIntegration(
  t: DoplTransport,
  input: {
    provider: IntegrationProvider;
    object_id: string;
    kb_id?: string;
    cluster_id?: string;
  }
): Promise<PrepareFromIntegrationResponse> {
  return t.request<PrepareFromIntegrationResponse>(
    `/api/ingest/prepare-from-integration`,
    {
      method: "POST",
      body: input,
      toolName: "ingest_from_integration",
    }
  );
}
