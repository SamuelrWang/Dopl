// Shim for the `server-only` package under vitest. The real package
// throws if imported from a client component context; vitest resolves
// modules in Node and trips that guard, so we replace it with a no-op.
export {};
