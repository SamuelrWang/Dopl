// The shared shape-contract harness runs green over a self-consistent fake runtime (its failure paths are
// `checkShape`'s, pinned in `sdk-shape.test.mjs`). Real runtimes call it from their own contract suites.
import { runShapeContract } from "./helpers/shape-contract.mjs";

const required = {
  safety: { results: { "thread/start": ["sandbox"] } },
  core: { methods: ["turn/start"] },
  cosmetic: { results: { "model/list": ["data.displayName"] } },
};

runShapeContract({
  runtimeId: "fake",
  required,
  fixture: {
    measured: true,
    version: "fake 1.0.0",
    shape: { methods: ["turn/start"], results: { "thread/start": ["sandbox"], "model/list": ["data.displayName"] } },
  },
  liveProbe: async () => ({ methods: ["turn/start"], results: { "thread/start": ["sandbox"] } }),
  liveEnv: "DOPL_FAKE_SHAPE_LIVE",
});
