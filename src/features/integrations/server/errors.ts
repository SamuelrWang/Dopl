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

export class IntegrationActionNotFoundError extends HttpError {
  constructor(provider: IntegrationProvider, action: string) {
    super(
      404,
      "INTEGRATION_ACTION_NOT_FOUND",
      `${provider} has no action "${action}". Call list_integration_actions to see what's available.`
    );
  }
}

export class IntegrationActionValidationError extends HttpError {
  constructor(provider: IntegrationProvider, action: string, message: string) {
    super(
      400,
      "INTEGRATION_ACTION_INVALID_PARAMS",
      `Invalid params for ${provider} action "${action}": ${message}`
    );
  }
}

export class IntegrationReadNotSupportedError extends HttpError {
  constructor(provider: IntegrationProvider) {
    super(
      501,
      "INTEGRATION_READ_NOT_SUPPORTED",
      `${provider} doesn't expose a read/list path through Dopl. Use \`list_integration_actions\` and \`execute_integration_action\` for write operations on this provider.`
    );
  }
}
