export const UNIQUE_VIOLATION = "23505";

export function dbFail(op: string, error: { message: string }): never {
  throw new Error(`glasses ${op} failed: ${error.message}`);
}
