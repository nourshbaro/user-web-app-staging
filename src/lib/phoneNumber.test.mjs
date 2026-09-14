import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  createEmptyPhoneValue,
  getPhoneCallingCode,
  initializePhoneValue,
  isAllowedPhoneCountry,
  toBackendPhoneDigits,
  updateNationalPhone,
} from "./phoneNumber.ts";

test("phone completion uses selected calling code plus national digits", () => {
  const lebanon = updateNationalPhone("71 037 568", "LB");
  const palestine = updateNationalPhone("0599 123 456", "PS");
  const internationalPaste = updateNationalPhone("+970599123456", "LB");

  assert.equal(lebanon.validation, "valid");
  assert.equal(toBackendPhoneDigits(lebanon.canonicalPhone), "96171037568");
  assert.equal(palestine.validation, "valid");
  assert.equal(toBackendPhoneDigits(palestine.canonicalPhone), "970599123456");
  assert.equal(internationalPaste.phoneCountry, "PS");
  assert.equal(
    toBackendPhoneDigits(internationalPaste.canonicalPhone),
    "970599123456",
  );
});

test("country metadata has unique identities and human-readable names", () => {
  assert.equal(DEFAULT_PHONE_COUNTRY, "LB");
  assert.equal(isAllowedPhoneCountry("IL"), false);
  assert.equal(
    PHONE_COUNTRIES.some(({ phoneCountry }) => phoneCountry === "IL"),
    false,
  );

  const identities = PHONE_COUNTRIES.map(
    ({ phoneCountry }) => phoneCountry,
  );

  assert.equal(new Set(identities).size, identities.length);

  for (const option of PHONE_COUNTRIES) {
    assert.ok(
      option.name.trim().length > 0,
      `Missing name for ${option.phoneCountry}`,
    );
    assert.notEqual(
      option.name,
      option.phoneCountry,
      `${option.phoneCountry} exposes its ISO code as its name`,
    );
    assert.equal(
      option.label,
      `${option.name} (+${option.callingCode})`,
    );
  }
});

test("country metadata resolves representative English names", () => {
  const expectedNames = {
    AC: "Ascension Island",
    AD: "Andorra",
    AE: "United Arab Emirates",
    AF: "Afghanistan",
    LB: "Lebanon",
    PS: "Palestine",
    FR: "France",
    CA: "Canada",
    US: "United States",
    TA: "Tristan da Cunha",
  };

  for (const [phoneCountry, expectedName] of Object.entries(expectedNames)) {
    const option = PHONE_COUNTRIES.find(
      (candidate) => candidate.phoneCountry === phoneCountry,
    );

    assert.ok(option, `Missing phone country ${phoneCountry}`);
    assert.equal(option.name, expectedName);
  }
});

test("Palestine is available by name with calling code +970", () => {
  const palestine = PHONE_COUNTRIES.find(
    ({ phoneCountry }) => phoneCountry === "PS",
  );

  assert.ok(palestine);
  assert.equal(palestine.name, "Palestine");
  assert.equal(palestine.callingCode, "970");
  assert.equal(palestine.label, "Palestine (+970)");
  assert.equal(getPhoneCallingCode("PS"), "970");
});

test("United States and Canada remain separate under calling code +1", () => {
  const unitedStates = PHONE_COUNTRIES.find(
    ({ phoneCountry }) => phoneCountry === "US",
  );
  const canada = PHONE_COUNTRIES.find(
    ({ phoneCountry }) => phoneCountry === "CA",
  );

  assert.ok(unitedStates);
  assert.ok(canada);
  assert.equal(unitedStates.callingCode, "1");
  assert.equal(canada.callingCode, "1");
  assert.notEqual(unitedStates.phoneCountry, canada.phoneCountry);
});

test("empty phone state defaults to Lebanon", () => {
  assert.deepEqual(createEmptyPhoneValue(), {
    phoneCountry: "LB",
    phoneNationalValue: "",
    canonicalPhone: null,
    validation: "empty",
  });
});

test("valid Lebanese national numbers produce canonical E.164 values", () => {
  assert.deepEqual(updateNationalPhone("71123456", "LB"), {
    phoneCountry: "LB",
    phoneNationalValue: "71 123 456",
    canonicalPhone: "+96171123456",
    validation: "valid",
  });
});

test("invalid and incomplete Lebanese numbers have no canonical value", () => {
  const incomplete = updateNationalPhone("71", "LB");
  const invalid = updateNationalPhone("00000000", "LB");

  assert.equal(incomplete.phoneCountry, "LB");
  assert.equal(incomplete.canonicalPhone, null);
  assert.equal(incomplete.validation, "invalid");

  assert.equal(invalid.phoneCountry, "LB");
  assert.equal(invalid.canonicalPhone, null);
  assert.equal(invalid.validation, "invalid");
});

test("valid Palestinian national number uses current max metadata", () => {
  assert.deepEqual(updateNationalPhone("0599123456", "PS"), {
    phoneCountry: "PS",
    phoneNationalValue: "0599 123 456",
    canonicalPhone: "+970599123456",
    validation: "valid",
  });
});

test("valid United States and Canadian numbers normalize independently", () => {
  assert.deepEqual(updateNationalPhone("2025550123", "US"), {
    phoneCountry: "US",
    phoneNationalValue: "(202) 555-0123",
    canonicalPhone: "+12025550123",
    validation: "valid",
  });

  assert.deepEqual(updateNationalPhone("4165550123", "CA"), {
    phoneCountry: "CA",
    phoneNationalValue: "(416) 555-0123",
    canonicalPhone: "+14165550123",
    validation: "valid",
  });
});

test("valid French number produces canonical E.164", () => {
  assert.deepEqual(updateNationalPhone("0612345678", "FR"), {
    phoneCountry: "FR",
    phoneNationalValue: "06 12 34 56 78",
    canonicalPhone: "+33612345678",
    validation: "valid",
  });
});

test("valid international paste changes phone metadata", () => {
  assert.deepEqual(updateNationalPhone("+33612345678", "LB"), {
    phoneCountry: "FR",
    phoneNationalValue: "06 12 34 56 78",
    canonicalPhone: "+33612345678",
    validation: "valid",
  });

  assert.deepEqual(updateNationalPhone("+970599123456", "LB"), {
    phoneCountry: "PS",
    phoneNationalValue: "0599 123 456",
    canonicalPhone: "+970599123456",
    validation: "valid",
  });

  assert.deepEqual(updateNationalPhone("+14165550123", "LB"), {
    phoneCountry: "CA",
    phoneNationalValue: "(416) 555-0123",
    canonicalPhone: "+14165550123",
    validation: "valid",
  });
});

test("Israeli international values are excluded without selecting IL", () => {
  assert.deepEqual(updateNationalPhone("+972501234567", "LB"), {
    phoneCountry: "LB",
    phoneNationalValue: "",
    canonicalPhone: null,
    validation: "excluded-country",
  });
});

test("malformed international values are not converted to Lebanon", () => {
  assert.deepEqual(updateNationalPhone("+not-a-number", "LB"), {
    phoneCountry: "LB",
    phoneNationalValue: "",
    canonicalPhone: null,
    validation: "invalid",
  });

  assert.deepEqual(updateNationalPhone("+1", "LB"), {
    phoneCountry: "LB",
    phoneNationalValue: "",
    canonicalPhone: null,
    validation: "invalid",
  });
});

test("saved international phone values restore their phone countries", () => {
  assert.deepEqual(initializePhoneValue("+96171123456"), {
    phoneCountry: "LB",
    phoneNationalValue: "71 123 456",
    canonicalPhone: "+96171123456",
    validation: "valid",
  });

  assert.deepEqual(initializePhoneValue("+970599123456"), {
    phoneCountry: "PS",
    phoneNationalValue: "0599 123 456",
    canonicalPhone: "+970599123456",
    validation: "valid",
  });

  assert.deepEqual(initializePhoneValue("+33612345678"), {
    phoneCountry: "FR",
    phoneNationalValue: "06 12 34 56 78",
    canonicalPhone: "+33612345678",
    validation: "valid",
  });

  assert.deepEqual(initializePhoneValue("+12025550123"), {
    phoneCountry: "US",
    phoneNationalValue: "(202) 555-0123",
    canonicalPhone: "+12025550123",
    validation: "valid",
  });

  assert.deepEqual(initializePhoneValue("+14165550123"), {
    phoneCountry: "CA",
    phoneNationalValue: "(416) 555-0123",
    canonicalPhone: "+14165550123",
    validation: "valid",
  });
});

test("saved Israeli and malformed international values remain invalid", () => {
  assert.deepEqual(initializePhoneValue("+972501234567"), {
    phoneCountry: "LB",
    phoneNationalValue: "",
    canonicalPhone: null,
    validation: "excluded-country",
  });

  assert.deepEqual(initializePhoneValue("+broken"), {
    phoneCountry: "LB",
    phoneNationalValue: "",
    canonicalPhone: null,
    validation: "invalid",
  });
});

test("legacy unprefixed saved phone defaults to Lebanon", () => {
  assert.deepEqual(initializePhoneValue("71123456"), {
    phoneCountry: "LB",
    phoneNationalValue: "71 123 456",
    canonicalPhone: "+96171123456",
    validation: "valid",
  });
});
