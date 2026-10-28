import { translate } from "../i18n/runtime.ts";
export type AccessibleSeatState = "available" | "selected" | "in cart" | "unavailable";

type SeatIdentityInput = {
  label?: unknown;
  row?: unknown;
  number?: unknown;
  status?: string | null;
};

type SeatAccessibilityInput = {
  seat: SeatIdentityInput;
  zoneName?: string | null;
  selected: boolean;
  inCart: boolean;
};

export type SeatAccessibility = {
  identity: string;
  state: AccessibleSeatState;
  label: string;
  hint: string | undefined;
  selected: boolean;
  disabled: boolean;
};

function meaningful(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function getSeatIdentity(seat: SeatIdentityInput) {
  const label = meaningful(seat.label);
  if (label) return label;

  const row = meaningful(seat.row);
  const number = meaningful(seat.number);
  if (row && number) return translate("seat.rowNumber", { row, number });
  if (number) return translate("seat.number", { number });
  if (row) return translate("seat.row", { row });
  return translate("seat.label");
}

export function getSeatAccessibility({
  seat,
  zoneName,
  selected,
  inCart,
}: SeatAccessibilityInput): SeatAccessibility {
  const identity = getSeatIdentity(seat);
  const available = seat.status === "available";
  const isSelected = available && selected && !inCart;
  const disabled = inCart || !available;
  const state: AccessibleSeatState = inCart
    ? "in cart"
    : isSelected
      ? "selected"
      : available
        ? "available"
        : "unavailable";
  const zone = meaningful(zoneName);

  return {
    identity,
    state,
    label: [zone, identity, translate(inCart ? "seat.state.inCart" : isSelected ? "seat.state.selected" : available ? "seat.state.available" : "seat.state.unavailable")].filter((part): part is string => Boolean(part)).join(", "),
    hint: disabled ? undefined : isSelected ? translate("seat.removeHint") : translate("seat.selectHint"),
    selected: isSelected,
    disabled,
  };
}
