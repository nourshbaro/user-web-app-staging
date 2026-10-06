import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const transpile = (source) =>
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const toModuleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const policyUrl = toModuleUrl(transpile(await read("../lib/appUpdatePolicy.ts")));
const serviceSource = transpile(await read("./appUpdate.ts"));
let instance = 0;

/** appUpdate.ts on a given platform / embedded version, with a recording fake `apiRequest`. */
async function load({ os = "android", version = "1.1.4", respond = async () => ({ data: { update_required: false, update_available: false } }) } = {}) {
  instance += 1;
  const key = `__appUpdate_${instance}`;
  const state = { calls: [], respond };
  globalThis[key] = state;
  const g = `globalThis[${JSON.stringify(key)}]`;
  const source = serviceSource
    .replace('from "@/lib/appUpdatePolicy"', `from ${JSON.stringify(policyUrl)}`)
    .replace('from "@/services/api"', `from ${JSON.stringify(toModuleUrl(`export async function apiRequest(path, init) { ${g}.calls.push([path, init]); return ${g}.respond(path); }`))}`)
    .replace('from "expo-constants"', `from ${JSON.stringify(toModuleUrl(`export default { expoConfig: { version: ${JSON.stringify(version)} } };`))}`)
    .replace('from "react-native"', `from ${JSON.stringify(toModuleUrl(`export const Platform = { OS: ${JSON.stringify(os)} };`))}`);
  const service = await import(toModuleUrl(`${source}\n// ${key}`));
  return { service, state };
}

test("the query carries the running platform and the installed version", async () => {
  const android = await load({ os: "android", version: "1.1.4" });
  await android.service.loadAppVersionCheck();
  assert.equal(android.state.calls[0][0], "/app-versions/check?platform=android&version=1.1.4");

  const ios = await load({ os: "ios", version: "2.0.1" });
  await ios.service.loadAppVersionCheck();
  assert.equal(ios.state.calls[0][0], "/app-versions/check?platform=ios&version=2.0.1");
});

test("the public check sends no session token and can never invalidate the session", async () => {
  const { service, state } = await load();
  await service.loadAppVersionCheck();
  assert.deepEqual(state.calls[0][1], { overrideAuthorizationToken: null, skipUnauthenticatedNotify: true });
});

test("nothing is asked on web or with an unusable installed version", async () => {
  for (const setup of [{ os: "web" }, { version: "" }, { version: "dev" }, { version: null }, { version: "1.2.3-beta" }]) {
    const { service, state } = await load(setup);
    assert.equal(await service.loadAppVersionCheck(), null, JSON.stringify(setup));
    assert.equal(state.calls.length, 0, JSON.stringify(setup));
  }
});

test("asked once per launch: every gate mount (identity changes remount it) shares one request", async () => {
  const { service, state } = await load();
  const [first, second] = await Promise.all([service.loadAppVersionCheck(), service.loadAppVersionCheck()]);
  await service.loadAppVersionCheck();
  assert.equal(state.calls.length, 1);
  assert.deepEqual(first, second);
});

test("a network failure fails open (no answer, no block)", async () => {
  const { service } = await load({ respond: async () => { throw new Error("offline"); } });
  assert.equal(await service.loadAppVersionCheck(), null);
});

test("a malformed answer fails open", async () => {
  for (const body of [null, "<html>", { data: { update_required: "yes" } }, { nope: true }]) {
    const { service } = await load({ respond: async () => body });
    assert.equal(await service.loadAppVersionCheck(), null, JSON.stringify(body));
  }
});

test("a valid answer is validated and returned", async () => {
  const PLAY = "https://play.google.com/store/apps/details?id=com.lfaticketing.app";
  const { service } = await load({
    respond: async () => ({ data: { update_required: true, update_available: false, latest_version: "1.2.0", min_supported_version: "1.2.0", store_url: PLAY, message: "Please update." } }),
  });
  assert.deepEqual(await service.loadAppVersionCheck(), {
    updateRequired: true, updateAvailable: false, latestVersion: "1.2.0", minSupportedVersion: "1.2.0", storeUrl: PLAY, message: "Please update.",
  });
});

test("the check is read once per launch at application level, never per screen", async () => {
  const hook = await read("../hooks/useAppUpdateDecision.ts");
  assert.match(hook, /useEffect\(\(\) => \{[\s\S]*loadAppVersionCheck\(\)[\s\S]*\}, \[\]\);/);
  const gate = await read("../components/maintenance/SystemStateGate.tsx");
  assert.match(gate, /const update = useAppUpdateDecision\(\);/);
  // Only the system-state gate calls the hook (screens never trigger the check).
  const { readdir } = await import("node:fs/promises");
  const root = new URL("../", import.meta.url);
  const files = (await readdir(root, { recursive: true }))
    .filter((file) => /\.tsx?$/.test(file) && !file.replaceAll("\\", "/").endsWith("hooks/useAppUpdateDecision.ts"));
  const callers = [];
  for (const file of files) {
    if ((await readFile(new URL(file.replaceAll("\\", "/"), root), "utf8")).includes("useAppUpdateDecision()")) callers.push(file.replaceAll("\\", "/"));
  }
  assert.deepEqual(callers, ["components/maintenance/SystemStateGate.tsx"]);
});
