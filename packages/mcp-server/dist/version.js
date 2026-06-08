"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientIdentifier = exports.packageVersion = exports.packageName = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
function loadPackageJson() {
    // The stdio binary runs from node_modules where `../package.json` resolves.
    // But when the Next.js app imports `@dopl/mcp-server/factory`, the module is
    // evaluated during the build / in a transpiled context where this relative
    // read can fail (ENOENT). Fall back to a static identity so module
    // evaluation NEVER throws — the version string is cosmetic (MCP handshake +
    // X-Dopl-Client header).
    try {
        const path = (0, path_1.join)(__dirname, "..", "package.json");
        const raw = (0, fs_1.readFileSync)(path, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return { name: "@dopl/mcp-server", version: "0.0.0" };
    }
}
const pkg = loadPackageJson();
exports.packageName = pkg.name;
exports.packageVersion = pkg.version;
exports.clientIdentifier = `${pkg.name}@${pkg.version}`;
