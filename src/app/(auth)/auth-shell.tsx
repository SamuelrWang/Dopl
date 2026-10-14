"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AuthSplitLayout } from "@/shared/layout/auth-split";
import {
  LOGIN_CARD_KEY,
  loginGlassCard,
  type LoginJourneyImages,
} from "@/features/onboarding/components/login-journey-showcase";

/**
 * The (auth) group's split shell, client-side only so it can read the route.
 *
 * ⚠ THE LOGIN CARD IS `/authenticate`'s ONLY (Samuel 2026-10-14: the web
 * login/sign-up must match the desktop's). `/login` and `/signup` redirect
 * there, so all three wear it. `/get-started` must NOT: it portals its install
 * animation into the glass slot, and the card paints over the slot. Naming a
 * pose is what turns the card on (`AuthSplitLayout` › glassPose), so the gate
 * is just this pathname check. The layout stays mounted across the group's
 * navigations, so moving between the two plays the card's normal fade.
 *
 * The images are the desktop's (`apps/desktop-ui/src/assets/`), copied to
 * `public/img/onboarding/` — a shared file cannot import images, and the
 * desktop's `?inline` is Vite-only. Same `LoginJourneyImages` shape, one
 * journey component.
 */
const IMG = "/img/onboarding";
const WEB_LOGIN_IMAGES: LoginJourneyImages = {
  you: `${IMG}/onboarding-avatar.jpg`,
  teammate: `${IMG}/onboarding-avatar-2.jpg`,
  teammate2: `${IMG}/onboarding-avatar-3.jpg`,
  grokPerson: `${IMG}/onboarding-avatar-4.jpg`,
  dopl: `${IMG}/dopl-mark.png`,
  claude: `${IMG}/claude-logo.svg`,
  grok: `${IMG}/grok-logo.svg`,
  chatgpt: `${IMG}/chatgpt-logo.svg`,
  muse: `${IMG}/muse-logo.svg`,
  hubspot: `${IMG}/hubspot-logo.svg`,
  slack: `${IMG}/slack-logo.svg`,
  sheets: `${IMG}/sheets-logo.svg`,
  // Stripe "S": Font Awesome Free brands icon, CC BY 4.0
  // (https://fontawesome.com/license/free) — attribution kept here.
  stripe: `${IMG}/stripe-logo.svg`,
  // Figma's official mark (public domain).
  figma: `${IMG}/figma-logo.svg`,
  // Samuel's own laptop image (trimmed, 128px transparent PNG).
  laptop: `${IMG}/laptop-icon.png`,
};
const LOGIN_CARD = loginGlassCard(WEB_LOGIN_IMAGES);

export function AuthShell({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  const card = usePathname() === "/authenticate";
  return (
    <AuthSplitLayout
      brand={brand}
      glassPose={card ? "default" : undefined}
      glassCardKey={card ? LOGIN_CARD_KEY : undefined}
      glassCardContent={card ? LOGIN_CARD : undefined}
    >
      {children}
    </AuthSplitLayout>
  );
}
