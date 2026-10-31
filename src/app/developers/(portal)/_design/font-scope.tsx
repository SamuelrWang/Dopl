import type { ReactNode } from "react";
import { designFont } from "./font";

/** The design font for everything inside, with no box of its own. */
export const FontScope = ({ children }: { children: ReactNode }) => (
  <div className={designFont.className} style={{ display: "contents" }}>
    {children}
  </div>
);
