/** A staged route's refusal; the shim answers it as the API's `{ error: { code, message } }` envelope. */
export class FakeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function notFound(what: string): FakeHttpError {
  return new FakeHttpError(404, "NOT_FOUND", `${what} not found`);
}
