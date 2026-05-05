"use strict";
/**
 * Integration methods for `DoplClient`. Each function takes the
 * shared `DoplTransport` as its first arg and hits the matching
 * Next.js route under `/api/integrations/...`. The `DoplClient`
 * class exposes them as instance methods (mirrors the per-domain
 * split that `knowledge.ts` started).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectIntegration = connectIntegration;
exports.getIntegrationStatus = getIntegrationStatus;
exports.listIntegrationObjects = listIntegrationObjects;
exports.readIntegrationObject = readIntegrationObject;
exports.listIntegrationActions = listIntegrationActions;
exports.listMyIntegrations = listMyIntegrations;
exports.executeIntegrationAction = executeIntegrationAction;
exports.prepareFromIntegration = prepareFromIntegration;
const enc = encodeURIComponent;
async function connectIntegration(t, provider) {
    return t.request(`/api/integrations/${enc(provider)}/connect`, { method: "POST", toolName: "connect_integration" });
}
async function getIntegrationStatus(t, provider) {
    return t.request(`/api/integrations/${enc(provider)}/status`, { toolName: "integration_status" });
}
async function listIntegrationObjects(t, provider, input = {}) {
    return t.request(`/api/integrations/${enc(provider)}/list`, {
        method: "POST",
        body: input,
        toolName: "list_integration_objects",
    });
}
async function readIntegrationObject(t, provider, input) {
    return t.request(`/api/integrations/${enc(provider)}/read`, {
        method: "POST",
        body: input,
        toolName: "read_integration_object",
    });
}
async function listIntegrationActions(t, provider, options = {}) {
    const qs = options.query
        ? `?query=${encodeURIComponent(options.query)}`
        : "";
    return t.request(`/api/integrations/${enc(provider)}/actions${qs}`, { toolName: "list_integration_actions" });
}
async function listMyIntegrations(t) {
    return t.request(`/api/integrations/connections`, { toolName: "list_my_integrations" });
}
async function executeIntegrationAction(t, provider, input) {
    return t.request(`/api/integrations/${enc(provider)}/execute`, {
        method: "POST",
        body: input,
        toolName: "execute_integration_action",
    });
}
async function prepareFromIntegration(t, input) {
    return t.request(`/api/ingest/prepare-from-integration`, {
        method: "POST",
        body: input,
        toolName: "ingest_from_integration",
    });
}
