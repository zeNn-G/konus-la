// VOICE UX PROTOTYPE (wayfinder #10) — THROWAWAY. Variant-switching mount points so the
// real shell files ($channelId route, channel-sidebar) each carry only a one-line hook.
// Everything renders null when `?voice=` is absent or in production builds.
import { VoiceProtoSwitcher, useVoiceProtoVariant } from "./shared";
import { useVoiceProto } from "./store";
import { ConnectionBarA, SidebarVoiceA, VoiceRoomA, useVoiceRoomTakeoverA } from "./variant-a";
import { FooterDeckB, SidebarVoiceB, VoiceMiniStageB } from "./variant-b";
import { SidebarVoiceC, VoiceStripC } from "./variant-c";

export { VoiceProtoSwitcher, useVoiceProtoVariant };

/** Variant A: true while the voice room should replace the channel pane. */
export function useVoiceProtoTakeover(channelId: string): boolean {
  const variant = useVoiceProtoVariant();
  const takeover = useVoiceRoomTakeoverA(channelId);
  return variant === "a" && takeover;
}

/** Variant A's full-pane room (render in place of the chat subtree). */
export function VoiceProtoRoom() {
  return (
    <>
      <VoiceRoomA />
      <VoiceProtoSwitcher />
    </>
  );
}

/** Variant C's filmstrip — mounts between the channel header and the chat row. */
export function VoiceProtoStrip() {
  const variant = useVoiceProtoVariant();
  return variant === "c" ? <VoiceStripC /> : null;
}

/** Variant B's floating mini-stage — mounts inside the (relative) chat column. */
export function VoiceProtoMiniStage() {
  const variant = useVoiceProtoVariant();
  return variant === "b" ? <VoiceMiniStageB /> : null;
}

/** Voice-channel rows under the text-channel nav; shape differs per variant. */
export function VoiceProtoSidebarSection() {
  const variant = useVoiceProtoVariant();
  if (variant === "a") return <SidebarVoiceA />;
  if (variant === "b") return <SidebarVoiceB />;
  if (variant === "c") return <SidebarVoiceC />;
  return null;
}

/** Connected-state UI in the sidebar footer, above the UserCard. C keeps the footer clean
 *  (its connection info lives in the strip). */
export function VoiceProtoSidebarFooter() {
  const variant = useVoiceProtoVariant();
  const { joinedId } = useVoiceProto();
  if (!joinedId) return null;
  if (variant === "a") return <ConnectionBarA />;
  if (variant === "b") return <FooterDeckB />;
  return null;
}
