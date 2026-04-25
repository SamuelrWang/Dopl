"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientIdentifier = exports.packageVersion = exports.packageName = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
function loadPackageJson() {
    const path = (0, path_1.join)(__dirname, "..", "package.json");
    const raw = (0, fs_1.readFileSync)(path, "utf8");
    return JSON.parse(raw);
}
const pkg = loadPackageJson();
exports.packageName = pkg.name;
exports.packageVersion = pkg.version;
exports.clientIdentifier = `${pkg.name}@${pkg.version}`;
