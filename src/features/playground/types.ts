/** Sections the playground mirror can show — the real shell's `NavSection`
 *  minus `overview` (the demo has no home page) and `ontology`. */
export type PlaygroundSection =
  | "knowledge"
  | "skills"
  | "chats"
  | "channels"
  | "members";
