import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { registrationName } from "./registrationName.ts";

const screen = await readFile(new URL("../app/auth.tsx", import.meta.url), "utf8");
const service = await readFile(new URL("../services/auth.ts", import.meta.url), "utf8");
const register = screen.slice(screen.indexOf(`if (mode === "register") {`), screen.indexOf(`if (mode === "otp") {`));

test("First + Last name combine into one name with a single space", () => {
  assert.deepEqual(registrationName("Nour", "Shbaro"), { ok: true, name: "Nour Shbaro" });
});

test("surrounding whitespace is trimmed; inner spacing of each part is kept", () => {
  assert.deepEqual(registrationName("  Nour\t", "\n Shbaro  "), { ok: true, name: "Nour Shbaro" });
  assert.deepEqual(registrationName("Mary Ann", "Van der Berg"), { ok: true, name: "Mary Ann Van der Berg" });
});

test("First name is required (empty or whitespace only)", () => {
  assert.deepEqual(registrationName("", "Shbaro"), { ok: false, missing: "firstName" });
  assert.deepEqual(registrationName("   ", "Shbaro"), { ok: false, missing: "firstName" });
});

test("Last name is required (empty or whitespace only)", () => {
  assert.deepEqual(registrationName("Nour", ""), { ok: false, missing: "lastName" });
  assert.deepEqual(registrationName("Nour", " \t "), { ok: false, missing: "lastName" });
});

test("no script restrictions: Arabic and other names pass as typed", () => {
  assert.deepEqual(registrationName("نور", "شبارو"), { ok: true, name: "نور شبارو" });
  assert.deepEqual(registrationName("Zoë", "O'Brien-Núñez"), { ok: true, name: "Zoë O'Brien-Núñez" });
});

test("the name is derived per call: an edit after a failure gives the new value", () => {
  assert.equal(registrationName("Nour", "").ok, false);
  assert.deepEqual(registrationName("Nour", "Shbaro"), { ok: true, name: "Nour Shbaro" });
  assert.deepEqual(registrationName("Nora", "Shbaro"), { ok: true, name: "Nora Shbaro" });
});

// --- Screen wiring (source) ---

test("the screen keeps separate name drafts and no cached combined name", () => {
  assert.match(screen, /const \[firstName, setFirstName\] = useState\(""\);/);
  assert.match(screen, /const \[lastName, setLastName\] = useState\(""\);/);
  assert.doesNotMatch(screen, /const \[name, setName\]/);
  assert.doesNotMatch(screen, /useMemo|combinedName|fullName/);
});

test("register builds the name at submit, from the live fields, before any request", () => {
  assert.match(register, /const nameResult = registrationName\(firstName, lastName\);\s*if \(!nameResult\.ok\) \{/);
  assert.match(register, /nameResult\.missing === "firstName" \? t\("auth\.error\.firstName"\) : t\("auth\.error\.lastName"\)/);
  // The name check returns before the request; the request sends only the result.
  assert.ok(register.indexOf("registrationName(") < register.indexOf("authService.register("));
  assert.match(register, /await authService\.register\(\s*nameResult\.name,\s*registrationEmail \|\| null,\s*password,\s*passwordConfirmation,\s*toBackendPhoneDigits\(registrationPhone\.canonicalPhone\),\s*\);/);
});

test("existing register validation is unchanged: email, confirmation, phone", () => {
  assert.match(register, /if \(registrationEmail && !isValidRecoveryEmail\(registrationEmail\)\)/);
  assert.match(register, /if \(password !== passwordConfirmation\) \{\s*notify\("error", t\("auth\.toast\.checkDetails"\), t\("auth\.error\.passwordMismatch"\)\);\s*return;/);
  assert.match(register, /if \(registrationPhone\.validation !== "valid"\)/);
  // Create account stays disabled until both name parts are filled.
  assert.match(screen, /\(!firstName\.trim\(\) \|\| !lastName\.trim\(\) \|\| !password \|\| !passwordConfirmation \|\| registrationPhone\.validation !== "valid"\)/);
});

test("two labelled name fields with name-part autofill", () => {
  assert.match(screen, /label=\{t\("auth\.field\.firstName"\)\}[\s\S]{0,200}textContentType="givenName"[\s\S]{0,80}autoComplete="given-name"/);
  assert.match(screen, /label=\{t\("auth\.field\.lastName"\)\}[\s\S]{0,200}textContentType="familyName"[\s\S]{0,80}autoComplete="family-name"/);
});

test("no name-part fields exist in the backend contract", () => {
  assert.doesNotMatch(service, /first_name|last_name|firstName|lastName/);
  assert.doesNotMatch(register, /first_name|last_name/);
});
