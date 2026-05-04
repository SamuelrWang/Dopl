import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import type { IntegrationProvider } from "../types";

export class IntegrationNotConnectedError extends HttpError {
  constructor(provider: IntegrationProvider) {
    super(
      409,
      "INTEGRATION_NOT_CONNECTED",
      `No ${provider} connection for this user. Call connect_integration first.`
    );
  }
}

export class IntegrationFetchError extends HttpError {
  constructor(provider: IntegrationProvider, message: string) {
    super(
      502,
      "INTEGRATION_FETCH_FAILED",
      `Couldn't fetch from ${provider}: ${message}`
    );
  }
}

export class ProviderNotConfiguredError extends HttpError {
  constructor(provider: IntegrationProvider) {
    super(
      503,
      "PROVIDER_NOT_CONFIGURED",
      `${provider} is not configured on this server. Contact support.`
    );
  }
}

export class IntegrationObjectNotFoundError extends HttpError {
  constructor(provider: IntegrationProvider, objectId: string) {
    super(
      404,
      "INTEGRATION_OBJECT_NOT_FOUND",
      `${provider} object ${objectId} not found or no longer accessible.`
    );
  }
}
