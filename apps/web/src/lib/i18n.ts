"use client";

import { useDemo, type Role } from "./store";

import { LANGS, renderMessage, tr, type Lang } from "@routelanka/domain";

export { LANGS, renderMessage, tr, type Lang };

export type T = (key: string, vars?: Record<string, string | number | undefined>) => string;

/** Text for a role in that role's chosen language. */
export function useT(role: Role): { t: T; lang: Lang } {
  const { s } = useDemo();
  const lang = s.lang?.[role] ?? "en";
  return { t: (k, v) => tr(lang, k, v), lang };
}
