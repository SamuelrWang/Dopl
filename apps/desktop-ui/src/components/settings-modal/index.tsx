import type { ComponentProps } from "react";
import { useNavigate } from "react-router";
import { SettingsModal as SharedSettingsModal } from "@/shared/layout/settings-modal/desktop-settings-modal";

export type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";

type Props = Omit<ComponentProps<typeof SharedSettingsModal>, "onNavigate">;

/** The SPA's Settings modal: the shared desktop binding on this router. */
export function SettingsModal(props: Props) {
  const navigate = useNavigate();
  return <SharedSettingsModal {...props} onNavigate={(path) => navigate(path)} />;
}
