"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maybeNotifyOfUpdate = maybeNotifyOfUpdate;
const version_js_1 = require("./version.js");
async function maybeNotifyOfUpdate() {
    if (process.env.NO_UPDATE_NOTIFIER === "1")
        return;
    if (process.argv.includes("--no-update-notifier"))
        return;
    try {
        // Why: update-notifier@7+ is ESM-only. Static import compiles to require()
        // and crashes on Node 18-21 with ERR_REQUIRE_ESM (only Node 22.12+ allows
        // require(esm)). Dynamic import works on Node 18+. Empty catch is
        // intentional — the notifier is a UX nicety, never a reason to fail the
        // user's actual command.
        const { default: updateNotifier } = await import("update-notifier");
        const notifier = updateNotifier({
            pkg: { name: version_js_1.packageName, version: version_js_1.packageVersion },
            updateCheckInterval: 1000 * 60 * 60 * 24,
            shouldNotifyInNpmScript: false,
        });
        notifier.notify({ defer: false, isGlobal: true });
    }
    catch {
        // intentionally swallowed — see "Why" above
    }
}
