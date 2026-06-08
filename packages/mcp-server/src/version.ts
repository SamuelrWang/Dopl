import { readFileSync } from "fs";
import { join } from "path";

interface PackageJson {
  name: string;
  version: string;
}

function loadPackageJson(): PackageJson {
  // The stdio binary runs from node_modules where `../package.json` resolves.
  // But when the Next.js app imports `@dopl/mcp-server/factory`, the module is
  // evaluated during the build / in a transpiled context where this relative
  // read can fail (ENOENT). Fall back to a static identity so module
  // evaluation NEVER throws — the version string is cosmetic (MCP handshake +
  // X-Dopl-Client header).
  try {
    const path = join(__dirname, "..", "package.json");
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return { name: "@dopl/mcp-server", version: "0.0.0" };
  }
}

const pkg = loadPackageJson();

export const packageName: string = pkg.name;
export const packageVersion: string = pkg.version;
export const clientIdentifier = `${pkg.name}@${pkg.version}`;
