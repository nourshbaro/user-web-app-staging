export function getDropdownTriggerLabel(
  fieldLabel: string,
  valueLabel: string,
) {
  return `${fieldLabel}, ${valueLabel}`;
}

export function isDropdownOptionSelected(
  selectedValue: string | undefined,
  optionValue: string | undefined,
) {
  return selectedValue === optionValue;
}

export function formatAccessibleDate(
  date: Date,
  locales?: Intl.LocalesArgument,
) {
  return new Intl.DateTimeFormat(locales, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function getDateTriggerLabel(
  date: Date | null,
  locales?: Intl.LocalesArgument,
) {
  return date
    ? `Match Date, ${formatAccessibleDate(date, locales)}`
    : "Match Date, not selected";
}