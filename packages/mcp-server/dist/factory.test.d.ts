/**
 * NET-NEW — bootServer workspace resolution + directory-load failure.
 *
 * The SDK `McpServer` is mocked (like server.test.ts) so `createServer`
 * registers tools without touching a real transport. We drive `bootServer`
 * over a stubbed `DoplClient` and assert what it wires onto the client
 * (`setWorkspaceId` — the on-the-wire default) and what it reports back
 * (`activeWorkspace`, `directoryLoadFailed`).
 */
export {};
