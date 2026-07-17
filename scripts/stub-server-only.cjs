/**
 * Neutralizes the `server-only` import guard so server modules can run in
 * plain Node for the smoke script (scripts/smoke-billing.mts). Preloaded
 * via NODE_OPTIONS="--require ./scripts/stub-server-only.cjs".
 */
const Module = require("module");
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  return origLoad.call(this, request, ...rest);
};
