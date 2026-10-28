import { translate } from "../i18n/runtime.ts";
import { getAppLocale, localeMeta } from "../i18n/locales.ts";

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
  return new Intl.DateTimeFormat(locales ?? localeMeta(getAppLocale()).tag, {
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
    ? translate("filters.dateA11y", { date: formatAccessibleDate(date, locales) })
    : translate("filters.dateUnselected");
}
