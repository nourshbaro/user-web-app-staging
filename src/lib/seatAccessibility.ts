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
  if (row && number) return `Row ${row}, Seat ${number}`;
  if (number) return `Seat ${number}`;
  if (row) return `Row ${row}`;
  return "Seat";
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
    label: [zone, identity, state].filter((part): part is string => Boolean(part)).join(", "),
    hint: disabled ? undefined : isSelected ? "Removes this seat from your selection." : "Selects this seat.",
    selected: isSelected,
    disabled,
  };
}
