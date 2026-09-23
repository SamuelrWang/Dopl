import {
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  isNetworkError,
} from "./api-envelope";

/**
 * THE copy for an error on screen, in both trees. Raw error text never renders:
 *   - network failure → {@link NETWORK_ERROR_MESSAGE};
 *   - a server 4xx → its own message (designed copy);
 *   - anything else (5xx, bridge failure, a JS error) → `fallback`, else
 *     {@link GENERIC_ERROR_MESSAGE}.
 * Framework-free; duck-typed so feature error classes that carry `status` qualify.
 */
export function userFacingMessage(
  error: unknown,
  fallback: string = GENERIC_ERROR_MESSAGE
): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  if (error && typeof error === "object") {
    const { status, message } = error as { status?: unknown; message?: unknown };
    if (
      typeof status === "number" &&
      status >= 400 &&
      status < 500 &&
      typeof message === "string" &&
      message.trim() !== "" &&
      // The decoder's placeholder for a bodiless answer is not copy.
      !/^Request failed \(\d+\)$/.test(message)
    ) {
      return message;
    }
  }
  return fallback;
}

export { GENERIC_ERROR_MESSAGE, NETWORK_ERROR_MESSAGE };
