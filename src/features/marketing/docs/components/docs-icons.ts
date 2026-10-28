import {
  Bell,
  Bot,
  Car,
  Code,
  FileClock,
  Glasses,
  Headphones,
  House,
  Laptop,
  Link2,
  MessageCircleQuestion,
  Monitor,
  MonitorSmartphone,
  Receipt,
  Rocket,
  Route,
  ShieldCheck,
  Smartphone,
  Speaker,
  SquareTerminal,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { DocIcon, DocSectionId } from "../content";

/** Content icons by name (cards, home lists). */
export const DOC_ICONS: Record<DocIcon, LucideIcon> = {
  show: Monitor,
  ask: MessageCircleQuestion,
  notify: Bell,
  connect: Link2,
  route: Route,
  glasses: Glasses,
  headphones: Headphones,
  phone: Smartphone,
  desktop: Laptop,
  speaker: Speaker,
  car: Car,
  robot: Bot,
  quickstart: Rocket,
  api: SquareTerminal,
  security: ShieldCheck,
  code: Code,
};

/** Sidebar icons: the home row and one per section. */
export const NAV_ICONS: Record<"home" | DocSectionId, LucideIcon> = {
  home: House,
  quickstart: Rocket,
  api: SquareTerminal,
  security: ShieldCheck,
  pricing: Receipt,
  changelog: FileClock,
  devices: MonitorSmartphone,
  core: Workflow,
  sdks: Code,
};
