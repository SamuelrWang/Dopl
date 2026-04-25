import { readFileSync } from "fs";
import { join } from "path";

interface PackageJson {
  name: string;
  version: string;
}

function loadPackageJson(): PackageJson {
  const path = join(__dirname, "..", "package.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as PackageJson;
}

const pkg = loadPackageJson();

export const packageName: string = pkg.name;
export const packageVersion: string = pkg.version;
export const clientIdentifier = `${pkg.name}@${pkg.version}`;
