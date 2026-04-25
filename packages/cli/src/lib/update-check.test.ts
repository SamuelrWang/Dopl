import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { maybeNotifyOfUpdate } from "./update-check.js";

describe("maybeNotifyOfUpdate", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.unstubAllEnvs();
    process.argv = ["node", "dopl"];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.argv = originalArgv;
  });

  it("returns immediately when NO_UPDATE_NOTIFIER=1", async () => {
    vi.stubEnv("NO_UPDATE_NOTIFIER", "1");
    await expect(maybeNotifyOfUpdate()).resolves.toBeUndefined();
  });

  it("returns immediately when --no-update-notifier flag is present", async () => {
    process.argv = ["node", "dopl", "--no-update-notifier", "packs", "list"];
    await expect(maybeNotifyOfUpdate()).resolves.toBeUndefined();
  });

  it("never throws even if the notifier dependency fails to load", async () => {
    await expect(maybeNotifyOfUpdate()).resolves.toBeUndefined();
  });
});
