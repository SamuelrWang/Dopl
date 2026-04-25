"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const update_check_js_1 = require("./update-check.js");
(0, vitest_1.describe)("maybeNotifyOfUpdate", () => {
    const originalArgv = process.argv;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.unstubAllEnvs();
        process.argv = ["node", "dopl"];
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllEnvs();
        process.argv = originalArgv;
    });
    (0, vitest_1.it)("returns immediately when NO_UPDATE_NOTIFIER=1", async () => {
        vitest_1.vi.stubEnv("NO_UPDATE_NOTIFIER", "1");
        await (0, vitest_1.expect)((0, update_check_js_1.maybeNotifyOfUpdate)()).resolves.toBeUndefined();
    });
    (0, vitest_1.it)("returns immediately when --no-update-notifier flag is present", async () => {
        process.argv = ["node", "dopl", "--no-update-notifier", "packs", "list"];
        await (0, vitest_1.expect)((0, update_check_js_1.maybeNotifyOfUpdate)()).resolves.toBeUndefined();
    });
    (0, vitest_1.it)("never throws even if the notifier dependency fails to load", async () => {
        await (0, vitest_1.expect)((0, update_check_js_1.maybeNotifyOfUpdate)()).resolves.toBeUndefined();
    });
});
