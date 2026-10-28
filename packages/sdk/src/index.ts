/**
 * `@dopl/sdk`: the TypeScript client for the Dopl Device SDK API (docs/specs/device-sdk/openapi.yaml).
 * The project-scoped MCP server lives at the `@dopl/sdk/mcp` subpath and the `dopl-sdk-mcp` bin.
 */
export { Dopl, ROUTES, newIdempotencyKey } from "./client.js";
export type { DoplOptions, RequestOptions, DeliverParams } from "./client.js";
export { DoplError, isErrorResponse } from "./errors.js";
export type { DoplErrorInit, SdkOnlyErrorCode } from "./errors.js";
export { DEFAULT_BASE_URL } from "./http.js";
export type { FetchLike } from "./http.js";
export { ASK_DEFAULT_POLL_MS, ASK_DEFAULT_TIMEOUT_MS } from "./helpers.js";
export type { AskOptions, AskResult, NotifyOptions, ShowOptions } from "./helpers.js";
export type {
  Action,
  ActionStatus,
  CapabilityId,
  ChoiceOption,
  Connection,
  ConnectionExchangeRequest,
  ConnectionExchangeResponse,
  ConnectionListResponse,
  ConnectSessionCreateRequest,
  ConnectSessionCreateResponse,
  DeliverContent,
  DeliverIntent,
  DeliverRequest,
  DeliverResponse,
  Device,
  DeviceActionResponse,
  DeviceContext,
  DisplayBlock,
  ErrorBody,
  ErrorCode,
  ErrorType,
  Urgency,
} from "@dopl/contracts/device-sdk";
