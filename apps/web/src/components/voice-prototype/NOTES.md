# Voice UX prototype — wayfinder ticket #10

**THROWAWAY.** Delete this folder plus the marked `VOICE PROTOTYPE (#10)` blocks in
`routes/(app)/guilds/$guildId/channels/$channelId.tsx` and `components/channel-sidebar.tsx`
once the verdict below is recorded on the ticket.

## Question

Where and how does voice UI live in the Phase 4 app shell? (Tile grid in pane vs overlay,
connection bar placement, sidebar voice rows, controls, device pickers, per-peer volume,
speaking treatment.)

## How to run

`bun run dev`, open any guild text channel, append `?voice=a` (dev builds only).
Flip variants with the floating bar or ←/→. All data is fake; join by clicking a voice row.

- **A — Room takeover**: voice channel is a place. Tile grid replaces the pane, control
  capsule docked bottom-center, device pickers behind the mic's chevron, per-peer volume in
  a hover popover on the tile, sidebar rows with nested occupant list, connection bar in
  the sidebar footer while browsing text. Speaking = square green ring on tile/avatar.
- **B — Voice rides along**: you never leave chat. Sidebar footer becomes a control deck +
  occupant panel with always-visible per-peer volume sliders; floating mini-stage
  (screenshare/active speaker) in the chat corner, expandable to an overlay grid.
  Speaking = green avatar ring.
- **C — Split stage**: filmstrip docked between header and messages; voice + text coexist.
  Controls inline at the strip's right end; collapses to an avatar row; per-peer volume by
  clicking a tile. Sidebar rows carry a facepile. Speaking = non-speakers dim + green
  baseline bar (ROADMAP's "tile dimming").

## Verdict

_(pending — fill in the winning variant / stolen pieces, then delete the prototype)_
