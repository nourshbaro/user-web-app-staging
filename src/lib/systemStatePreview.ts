import type { SystemState } from "@/lib/appUpdatePolicy";

/**
 * Development-only preview of the system states (maintenance, update
 * available, update required), so they can be checked on a device without a
 * backend policy and without editing production rules.
 *
 * Writes are ignored unless the caller passes `enabled` (`__DEV__` at the call
 * sites), so a production build can never be switched into a preview. A
 * preview never touches the real maintenance flag, the session or the cart,
 * and it carries no store URL, version or release notes (nothing invented).
 *
 * Driven by a dev deep link, e.g.
 * `lfa-app:///?systemStatePreview=maintenance` | `updateAvailable` |
 * `updateRequired` | `normal` (clears the preview).
 */
export type SystemStatePreview = Exclude<SystemState, "app"> | null;

const PREVIEW_STATES: readonly SystemStatePreview[] = ["maintenance", "updateAvailable", "updateRequired"];
const PREVIEW_PARAM = /[?&]systemStatePreview=([A-Za-z]+)(?:[&#]|$)/;

let preview: SystemStatePreview = null;
const listeners = new Set<() => void>();

export function parseSystemStatePreview(value: unknown): SystemStatePreview {
  return PREVIEW_STATES.find((state) => state === value) ?? null;
}

/**
 * The preview a dev link asks for: a state, `null` for `normal`, or
 * `undefined` when the link carries no (valid) preview command.
 */
export function systemStatePreviewFromUrl(url: unknown): SystemStatePreview | undefined {
  if (typeof url !== "string") return undefined;
  const value = PREVIEW_PARAM.exec(url)?.[1];
  if (!value) return undefined;
  if (value === "normal") return null;
  return parseSystemStatePreview(value) ?? undefined;
}

export function setSystemStatePreview(next: SystemStatePreview, enabled: boolean) {
  if (!enabled || preview === next) return;
  preview = next;
  listeners.forEach((listener) => listener());
}

export function getSystemStatePreview() {
  return preview;
}

export function subscribeSystemStatePreview(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
