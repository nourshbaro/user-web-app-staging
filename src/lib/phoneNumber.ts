import { getAppLocale, type AppLocale } from "../i18n/locales.ts";
import { translate } from "../i18n/runtime.ts";
import arabicCountryNames from "./arabicCountryNames.cjs";
// Browser entry on purpose: the package's Node `main` (entry-node.js) loads every
// locale with a dynamic require that Metro cannot bundle, which broke web SSR.
// Register only the English and Arabic data explicitly; do not use entry-node.js.
import countries from "i18n-iso-countries/index.js";
import englishCountryNames from "./englishCountryNames.cjs";
import {
    AsYouType,
    getCountries,
    getCountryCallingCode,
    parsePhoneNumberFromString,
    type CountryCode,
} from "libphonenumber-js/max";

export type PhoneCountryCode = CountryCode;

export type PhoneValidationState =
    | "empty"
    | "valid"
    | "invalid"
    | "excluded-country";

export interface PhoneCountryOption {
    phoneCountry: PhoneCountryCode;
    name: string;
    callingCode: string;
    label: string;
}

export interface PhoneValue {
    phoneCountry: PhoneCountryCode;
    phoneNationalValue: string;
    canonicalPhone: string | null;
    validation: PhoneValidationState;
}

export const DEFAULT_PHONE_COUNTRY: PhoneCountryCode = "LB";

const EXCLUDED_PHONE_COUNTRIES = new Set<string>(["IL"]);

const NON_ISO_PHONE_COUNTRY_NAMES: Partial<
    Record<PhoneCountryCode, string>
> = {
    AC: "Ascension Island",
    TA: "Tristan da Cunha",
};

const PREFERRED_PHONE_COUNTRY_NAMES: Partial<
    Record<PhoneCountryCode, string>
> = {
    PS: "Palestine",
    US: "United States",
};

countries.registerLocale(englishCountryNames);
countries.registerLocale(arabicCountryNames);

function resolvePhoneCountryName(
    phoneCountry: PhoneCountryCode,
): string {
    const name =
        NON_ISO_PHONE_COUNTRY_NAMES[phoneCountry] ??
        PREFERRED_PHONE_COUNTRY_NAMES[phoneCountry] ??
        countries.getName(phoneCountry, "en", { select: "official" });

    if (!name) {
        throw new Error(
            `Missing English phone-country name for ${phoneCountry}.`,
        );
    }

    return name;
}

export const PHONE_COUNTRIES: readonly PhoneCountryOption[] = getCountries()
    .filter((phoneCountry) => !EXCLUDED_PHONE_COUNTRIES.has(phoneCountry))
    .map((phoneCountry) => {
        const name = resolvePhoneCountryName(phoneCountry);
        const callingCode = getCountryCallingCode(phoneCountry);

        return {
            phoneCountry,
            name,
            callingCode,
            label: `${name} (+${callingCode})`,
        };
    })
    .sort(
        (left, right) =>
            left.name.localeCompare(right.name, "en") ||
            left.phoneCountry.localeCompare(right.phoneCountry, "en"),
    );

const allowedPhoneCountries = new Set<string>(
    PHONE_COUNTRIES.map(({ phoneCountry }) => phoneCountry),
);

const phoneCountryNames = new Map<PhoneCountryCode, string>(
    PHONE_COUNTRIES.map(({ phoneCountry, name }) => [phoneCountry, name]),
);

export function isAllowedPhoneCountry(
    phoneCountry: string | null | undefined,
): phoneCountry is PhoneCountryCode {
    return typeof phoneCountry === "string" && allowedPhoneCountries.has(phoneCountry);
}

export function getPhoneCountryName(phoneCountry: PhoneCountryCode, locale = getAppLocale()): string {
    if (locale === "ar") {
        if (phoneCountry === "AC") return "\u062c\u0632\u064a\u0631\u0629 \u0623\u0633\u0646\u0634\u064a\u0648\u0646";
        if (phoneCountry === "TA") return "\u062a\u0631\u064a\u0633\u062a\u0627\u0646 \u062f\u0627 \u0643\u0648\u0646\u0627";
        return countries.getName(phoneCountry, "ar", { select: "official" }) ?? phoneCountry;
    }
    return phoneCountryNames.get(phoneCountry) ?? translate("phone.country.unknown");
}

/** Presentation only: membership, calling codes and validation remain unchanged. */
export function phoneCountryOptions(locale: AppLocale, search = ""): PhoneCountryOption[] {
    const query = search.trim().toLowerCase();
    const codeQuery = query.replace(/^\+/, "");
    const options = PHONE_COUNTRIES.map((option) => ({
        ...option,
        name: getPhoneCountryName(option.phoneCountry, locale),
        label: `${getPhoneCountryName(option.phoneCountry, locale)} (+${option.callingCode})`,
    }));

    // English keeps the established order. Arabic collation is optional on
    // Hermes: never require Intl.Collator at startup or to open the picker.
    if (locale === "ar") {
        let compare: (a: string, b: string) => number = compareArabicNames;
        try {
            if (typeof Intl !== "undefined" && typeof Intl.Collator === "function") {
                const collator = new Intl.Collator("ar");
                if (collator.resolvedOptions().locale.startsWith("ar")) compare = collator.compare;
            }
        } catch { /* Use the deterministic Arabic alphabet fallback below. */ }
        options.sort((a, b) => compare(a.name, b.name) || compareCodePoints(a.phoneCountry, b.phoneCountry));
    }

    return options.filter((option) => !query
        || option.name.toLowerCase().includes(query)
        || getPhoneCountryName(option.phoneCountry, "ar").toLowerCase().includes(query)
        || getPhoneCountryName(option.phoneCountry, "en").toLowerCase().includes(query)
        || option.phoneCountry.toLowerCase().includes(query)
        || option.callingCode.includes(codeQuery));
}

function compareCodePoints(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

function compareArabicNames(a: string, b: string) {
    // Fold hamza/alef variants and vowel marks before comparing Arabic letters.
    const normalize = (value: string) => value.replace(/[\u064b-\u065f\u0670\u0640]/g, "")
        .replace(/[أإآٱ]/g, "ا").replace(/ؤ/g, "و").replace(/[ئى]/g, "ي").replace(/ة/g, "ه");
    return compareCodePoints(normalize(a), normalize(b));
}

export function getPhoneCallingCode(phoneCountry: PhoneCountryCode): string {
    return getCountryCallingCode(phoneCountry);
}

export function createEmptyPhoneValue(
    phoneCountry: PhoneCountryCode = DEFAULT_PHONE_COUNTRY,
): PhoneValue {
    return {
        phoneCountry,
        phoneNationalValue: "",
        canonicalPhone: null,
        validation: "empty",
    };
}

function internationalInvalidValue(
    currentPhoneCountry: PhoneCountryCode,
    validation: Extract<PhoneValidationState, "invalid" | "excluded-country">,
): PhoneValue {
    return {
        phoneCountry: currentPhoneCountry,
        phoneNationalValue: "",
        canonicalPhone: null,
        validation,
    };
}

export function updateNationalPhone(
    input: string,
    currentPhoneCountry: PhoneCountryCode,
): PhoneValue {
    const value = input.trimStart();

    if (!value) return createEmptyPhoneValue(currentPhoneCountry);

    if (value.startsWith("+")) {
        const internationalPhone = parsePhoneNumberFromString(value);

        if (internationalPhone?.country === "IL") {
            return internationalInvalidValue(
                currentPhoneCountry,
                "excluded-country",
            );
        }

        if (
            internationalPhone?.country &&
            isAllowedPhoneCountry(internationalPhone.country) &&
            internationalPhone.isValid()
        ) {
            return {
                phoneCountry: internationalPhone.country,
                phoneNationalValue: internationalPhone.formatNational(),
                canonicalPhone: internationalPhone.number,
                validation: "valid",
            };
        }

        return internationalInvalidValue(currentPhoneCountry, "invalid");
    }

    const phoneNationalValue = new AsYouType(currentPhoneCountry).input(value);

    if (!phoneNationalValue) {
        return input.trim()
            ? {
                phoneCountry: currentPhoneCountry,
                phoneNationalValue: "",
                canonicalPhone: null,
                validation: "invalid",
            }
            : createEmptyPhoneValue(currentPhoneCountry);
    }

    const phone = parsePhoneNumberFromString(
        phoneNationalValue,
        currentPhoneCountry,
    );

    if (
        !phone ||
        phone.country !== currentPhoneCountry ||
        !phone.isValid()
    ) {
        return {
            phoneCountry: currentPhoneCountry,
            phoneNationalValue,
            canonicalPhone: null,
            validation: "invalid",
        };
    }

    return {
        phoneCountry: currentPhoneCountry,
        phoneNationalValue: phone.formatNational(),
        canonicalPhone: phone.number,
        validation: "valid",
    };
}

/**
 * Converts an E.164 canonical phone number (e.g. "+96171123456") into the
 * digits-only format the backend expects (e.g. "96171123456").
 */
export function toBackendPhoneDigits(
    canonicalPhone: string | null | undefined,
): string {
    return canonicalPhone ? canonicalPhone.replace(/^\+/, "") : "";
}

/** Digits-only backend phone ("96171123456") → international display ("+961 71 123 456"). */
export function formatBackendPhoneForDisplay(digits: string): string {
    const phone = parsePhoneNumberFromString(`+${digits}`);
    return phone?.isValid() ? phone.formatInternational() : `+${digits}`;
}

export function initializePhoneValue(
    savedPhone: string | null | undefined,
    fallbackPhoneCountry: PhoneCountryCode = DEFAULT_PHONE_COUNTRY,
): PhoneValue {
    const value = savedPhone?.trim() ?? "";

    if (!value) return createEmptyPhoneValue(fallbackPhoneCountry);

    if (value.startsWith("+")) {
        return updateNationalPhone(value, fallbackPhoneCountry);
    }

    return updateNationalPhone(value, fallbackPhoneCountry);
}
