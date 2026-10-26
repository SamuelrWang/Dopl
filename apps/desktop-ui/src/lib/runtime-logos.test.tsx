import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { RuntimeLogoProvider, useRuntimeLogo } from "@/shared/ui/runtime-logo";
import { spaRuntimeLogo } from "./runtime-logos";

/** The packaged renderer is a `file://` document: every badge must be a bundled data URI, never
 *  the web's `/img/` path, which resolves to nothing there. */
describe("the SPA's runtime badges", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RuntimeLogoProvider value={spaRuntimeLogo}>{children}</RuntimeLogoProvider>
  );

  it("resolves every badged runtime to a bundled data URI", () => {
    const { result } = renderHook(() => useRuntimeLogo(), { wrapper });
    for (const runtime of ["claude", "codex", "grok", "muse"]) {
      expect(result.current(runtime)).toMatch(/^data:image\/svg\+xml/);
    }
  });

  it("draws no badge for a runtime with no mark, or none at all", () => {
    const { result } = renderHook(() => useRuntimeLogo(), { wrapper });
    expect(result.current("cursor")).toBeNull();
    expect(result.current("")).toBeNull();
    expect(result.current(null)).toBeNull();
  });
});
