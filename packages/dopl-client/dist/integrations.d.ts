/**
 * Integration methods for `DoplClient`. Each function takes the
 * shared `DoplTransport` as its first arg and hits the matching
 * Next.js route under `/api/integrations/...`. The `DoplClient`
 * class exposes them as instance methods (mirrors the per-domain
 * split that `knowledge.ts` started).
 */
import type { DoplTransport } from "./transport.js";
import type { ConnectResponse, IntegrationActionResultResponse, IntegrationActionsResponse, IntegrationListResponse, IntegrationProvider, IntegrationStatusResponse, PrepareFromIntegrationResponse, ReadIntegrationObjectResponse } from "./integration-types.js";
export declare function connectIntegration(t: DoplTransport, provider: IntegrationProvider): Promise<ConnectResponse>;
export declare function getIntegrationStatus(t: DoplTransport, provider: IntegrationProvider): Promise<IntegrationStatusResponse>;
export declare function listIntegrationObjects(t: DoplTransport, provider: IntegrationProvider, input?: {
    query?: string;
    cursor?: string;
    limit?: number;
}): Promise<IntegrationListResponse>;
export declare function readIntegrationObject(t: DoplTransport, provider: IntegrationProvider, input: {
    object_id: string;
}): Promise<ReadIntegrationObjectResponse>;
export declare function listIntegrationActions(t: DoplTransport, provider: IntegrationProvider): Promise<IntegrationActionsResponse>;
export declare function executeIntegrationAction(t: DoplTransport, provider: IntegrationProvider, input: {
    action: string;
    params: Record<string, unknown>;
}): Promise<IntegrationActionResultResponse>;
export declare function prepareFromIntegration(t: DoplTransport, input: {
    provider: IntegrationProvider;
    object_id: string;
    kb_id?: string;
    cluster_id?: string;
}): Promise<PrepareFromIntegrationResponse>;
