// The feature's PUBLIC surface, and it is one symbol wide on purpose.
//
// This barrel used to re-export `RoomsSidebar`, `useChannelAgents` and fifteen types. Nothing
// outside the feature imported any of them — the two components are consumed by `channel-pane.tsx`
// through relative paths, and every type consumer imports `./types` directly — so the re-exports
// were an alias surface that kept deleted-adjacent names looking load-bearing. The only real
// import is `channels/page.tsx`, and it wants `ChannelsView`.
export { ChannelsView } from "./components/channels-view";
