/**
 * Test support: loads React Native's REAL style-diff code from node_modules
 * (`ReactNativeAttributePayload.diff` plus the real `processTransform`,
 * `processFontVariant` and `processBoxShadow`) under Node, by stripping Flow
 * with the project's Babel. Tests use it to replay a component's successive
 * style props through the renderer's own diff — the code that runs on device
 * when a press or selection changes a style — instead of asserting on source
 * text. `__DEV__` is on, exactly as in a development build.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectRequire = createRequire(resolve(projectRoot, "package.json"));
const babel = projectRequire("@babel/core");
const libraries = resolve(projectRoot, "node_modules/react-native/Libraries");

globalThis.__DEV__ = true;
const cache = new Map();

function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const { code } = babel.transformSync(readFileSync(file, "utf8"), {
    filename: file,
    babelrc: false,
    configFile: false,
    plugins: [
      projectRequire.resolve("babel-plugin-syntax-hermes-parser"),
      projectRequire.resolve("@babel/plugin-transform-flow-strip-types"),
      projectRequire.resolve("@babel/plugin-transform-modules-commonjs"),
    ],
  });
  const module = { exports: {} };
  cache.set(file, module);
  const localRequire = (specifier) => {
    if (specifier.startsWith(".")) {
      const base = resolve(dirname(file), specifier);
      return load(base.endsWith(".js") ? base : `${base}.js`);
    }
    return projectRequire(specifier);
  };
  new Function("module", "exports", "require", code)(module, module.exports, localRequire);
  return module.exports;
}

const lib = (path) => load(resolve(libraries, path));
const { diff } = lib("ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload.js");
const processTransform = lib("StyleSheet/processTransform.js").default;
const processFontVariant = lib("StyleSheet/processFontVariant.js").default;

/** The style attribute configuration native views use for the keys under test. */
export const styleAttributes = {
  style: {
    transform: { process: processTransform },
    fontVariant: { process: processFontVariant },
    // processBoxShadow pulls in the whole colour stack; its null-guard is covered by RN itself.
    boxShadow: true,
    opacity: true,
    backgroundColor: true,
    color: true,
    borderRadius: true,
    minHeight: true,
    paddingHorizontal: true,
    flexDirection: true,
    alignItems: true,
    maxWidth: true,
    fontSize: true,
    lineHeight: true,
    fontFamily: true,
    fontWeight: true,
    flexShrink: true,
    textAlign: true,
    textTransform: true,
  },
};

/**
 * Replays successive `style` props through React Native's own diff, as the
 * renderer does on each commit. Throws exactly what the device would throw.
 */
export function replayStyles(styles) {
  const payloads = [];
  for (let index = 1; index < styles.length; index += 1) {
    payloads.push(diff({ style: styles[index - 1] }, { style: styles[index] }, styleAttributes));
  }
  return payloads;
}
