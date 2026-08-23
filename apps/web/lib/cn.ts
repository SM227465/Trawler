/** Minimal class joiner. No clsx/tailwind-merge — this project owns its
 *  class strings and never needs conflict resolution. */
export const cn = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");
