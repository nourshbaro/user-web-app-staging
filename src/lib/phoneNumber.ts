// Browser entry on purpose: the package's Node `main` (entry-node.js) loads every
// locale with a dynamic require that Metro cannot bundle, which broke web SSR.
// English is registered explicitly below, so no other locale data is needed.
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

export function getPhoneCountryName(phoneCountry: PhoneCountryCode): string {
    return phoneCountryNames.get(phoneCountry) ?? "Unknown country";
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
