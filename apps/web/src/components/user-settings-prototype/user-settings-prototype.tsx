// PROTOTYPE — THROWAWAY (wayfinder ticket #77). Root mount for the (app) layout:
// renders the active variant's dialog plus the floating switcher. The dialog closes on
// a variant change so each take is entered fresh from its own trigger.

import { getRouteApi } from "@tanstack/react-router";
import { useEffect } from "react";

import { usePrototypeStore } from "./store";
import { UserSettingsPrototypeSwitcher } from "./switcher";
import { useSettingsVariant } from "./use-variant";
import { VariantATakeover } from "./variant-a-takeover";
import { VariantBModal } from "./variant-b-modal";
import { VariantCScroll } from "./variant-c-scroll";

const appRoute = getRouteApi("/(app)");

export function UserSettingsPrototype() {
  const variant = useSettingsVariant();
  const { session } = appRoute.useRouteContext();
  const close = usePrototypeStore((s) => s.close);

  useEffect(() => {
    close();
  }, [variant, close]);

  if (!import.meta.env.DEV || variant === null) return null;

  const user = {
    name: session.user.name,
    username: session.user.username ?? session.user.email,
    image: session.user.image,
    isAdmin: session.user.role === "admin",
  };

  return (
    <>
      {variant === "a" && <VariantATakeover user={user} />}
      {variant === "b" && <VariantBModal user={user} />}
      {variant === "c" && <VariantCScroll user={user} />}
      <UserSettingsPrototypeSwitcher />
    </>
  );
}
