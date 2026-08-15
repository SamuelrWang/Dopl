import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetBridgedImageCache,
  useBridgedImageSrc,
} from "@/shared/hooks/use-bridged-image-src";
import { Avatar } from "@/shared/ui/avatar";
import { installBridge } from "#/test-utils/bridge";

/**
 * `useBridgedImageSrc`: OAuth avatars render as initials in the packaged
 * renderer because `profiles.avatar_url` points at CDNs `img-src` cannot
 * enumerate, so main proxies the bytes back as a `data:` URI.
 *
 * Lives in the WEB tree, exercised HERE because this is the app with jsdom.
 * ⚠ The bridge-absent case must be a verbatim, request-free passthrough or
 * every usedopl.com avatar regresses.
 */

const GOOGLE = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";
const SUPABASE = "https://mrefkedvdehahjejreae.supabase.co/storage/v1/i.png";

const PERSON = {
  userId: "u-1",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  avatarUrl: GOOGLE,
};

function Probe({ url }: { url: string | null }) {
  const src = useBridgedImageSrc(url);
  return <span data-testid="src">{src === undefined ? "(none)" : src}</span>;
}

const read = () => screen.getByTestId("src").textContent;

afterEach(() => {
  __resetBridgedImageCache();
  // ⚠ Leave no bridge behind — `getSpaBridge()` reads `window.dopl` live.
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "dopl");
  vi.unstubAllGlobals();
});

describe("web (no SPA bridge)", () => {
  it("passes every URL through verbatim", () => {
    render(<Probe url={GOOGLE} />);
    expect(read()).toBe(GOOGLE);
  });

  it("answers undefined for an absent image, never an empty src", () => {
    render(<Probe url={null} />);
    expect(read()).toBe("(none)");
  });

  it("is not fooled by the LEGACY desktop wrapper's partial window.dopl", () => {
    // The legacy wrapper exposes `window.dopl` with no `apiRequest` and loads
    // the live web app, where a bridged src would be a broken image.
    installBridge({ isDesktop: true, avatarDataUri: vi.fn() });
    render(<Probe url={GOOGLE} />);
    expect(read()).toBe(GOOGLE);
  });
});

describe("SPA (bridge present)", () => {
  const spa = (avatarDataUri: unknown) =>
    installBridge({ apiRequest: vi.fn(), avatarDataUri });

  it("resolves a foreign URL through the bridge, undefined while pending", async () => {
    let settle: (v: string | null) => void = () => {};
    const avatarDataUri = vi.fn(
      () => new Promise<string | null>((r) => (settle = r))
    );
    spa(avatarDataUri);

    render(<Probe url={GOOGLE} />);
    // Pending: caller keeps its fallback, no CSP-blocked request.
    expect(read()).toBe("(none)");
    expect(avatarDataUri).toHaveBeenCalledWith(GOOGLE);

    settle("data:image/png;base64,QUFB");
    await waitFor(() => expect(read()).toBe("data:image/png;base64,QUFB"));
  });

  it("stays undefined when main refuses (null) — the initials fallback holds", async () => {
    spa(vi.fn(async () => null));
    render(<Avatar person={PERSON} />);
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders the proxied bytes once main answers", async () => {
    spa(vi.fn(async () => "data:image/png;base64,QUFB"));
    render(<Avatar person={PERSON} />);
    const img = await screen.findByAltText("Ada Lovelace");
    expect(img).toHaveAttribute("src", "data:image/png;base64,QUFB");
  });

  it("refuses a non-image answer rather than setting it as img.src", async () => {
    spa(vi.fn(async () => "javascript:alert(1)"));
    render(<Probe url={GOOGLE} />);
    await waitFor(() => expect(read()).toBe("(none)"));
  });

  it("passes CSP-permitted URLs straight through without a round trip", () => {
    const avatarDataUri = vi.fn();
    spa(avatarDataUri);
    for (const url of [SUPABASE, "data:image/png;base64,QUFB", "./assets/mark.png"]) {
      const { unmount } = render(<Probe url={url} />);
      expect(read()).toBe(url);
      unmount();
    }
    expect(avatarDataUri).not.toHaveBeenCalled();
  });

  it("asks main ONCE for a URL shared by many members", async () => {
    const avatarDataUri = vi.fn(async () => "data:image/png;base64,QUFB");
    spa(avatarDataUri);
    render(
      <>
        <Probe url={GOOGLE} />
        <Probe url={GOOGLE} />
        <Probe url={GOOGLE} />
      </>
    );
    await waitFor(() => expect(screen.getAllByTestId("src")[0].textContent).toBe(
      "data:image/png;base64,QUFB"
    ));
    expect(avatarDataUri).toHaveBeenCalledTimes(1);
  });

  it("leaves the fallback in place on an older main with no such handler", () => {
    installBridge({ apiRequest: vi.fn() });
    render(<Probe url={GOOGLE} />);
    // No bridged op: raw URL returned, as before this hook.
    expect(read()).toBe(GOOGLE);
  });

  it("degrades to the fallback when the bridge call rejects", async () => {
    spa(vi.fn(async () => {
      throw new Error("window gone");
    }));
    render(<Probe url={GOOGLE} />);
    await waitFor(() => expect(read()).toBe("(none)"));
  });
});
