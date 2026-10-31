/**
 * Runs a developer's snippet in a Web Worker with a `dopl` stub: no page, no DOM, no network, and it
 * is killed after 3 seconds. Every call comes back to be drawn. The real one would call the API in
 * test mode with the same shape.
 */
export interface RunCall {
  method: "deliver" | "act" | "read";
  capability: string;
  text?: string;
  lines?: string[];
  options?: string[];
  value?: string;
}
export interface RunResult {
  calls: RunCall[];
  logs: string[];
  error: string | null;
}

const WORKER = `
self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.importScripts = undefined;
const logs = [];
const calls = [];
const record = (method) => async (input) => {
  const o = input || {};
  const c = o.content || {};
  calls.push({ method, capability: String(o.capability), text: c.text === undefined ? undefined : String(c.text), lines: Array.isArray(c.lines) ? c.lines.map(String) : undefined, options: Array.isArray(c.options) ? c.options.map(String) : undefined, value: o.value === undefined ? undefined : String(o.value) });
  return { id: "act_" + calls.length, status: "queued" };
};
const dopl = { deliver: record("deliver"), act: record("act"), read: record("read") };
const console = { log: (...a) => logs.push(a.map(String).join(" ")) };
self.onmessage = async (e) => {
  try {
    const AsyncFunction = (async () => {}).constructor;
    await new AsyncFunction("dopl", "console", e.data)(dopl, console);
    self.postMessage({ calls, logs, error: null });
  } catch (err) {
    self.postMessage({ calls, logs, error: String(err && err.message ? err.message : err) });
  }
};
`;

export function runSnippet(code: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
    const worker = new Worker(url);
    const finish = (result: RunResult) => {
      clearTimeout(limit);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const limit = setTimeout(() => finish({ calls: [], logs: [], error: "Stopped after 3 seconds" }), 3000);
    worker.onmessage = (e) => finish(e.data as RunResult);
    worker.onerror = (e) => finish({ calls: [], logs: [], error: e.message });
    worker.postMessage(code);
  });
}
