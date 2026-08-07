// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
    settings: {
      "import/resolver": {
        typescript: {
          project: "./tsconfig.json",
          extensions: [
            ".native.ts",
            ".native.tsx",
            ".ios.ts",
            ".ios.tsx",
            ".android.ts",
            ".android.tsx",
            ".web.ts",
            ".web.tsx",
            ".ts",
            ".tsx",
            ".d.ts",
            ".js",
            ".jsx",
            ".json",
            ".node",
          ],
        },
      },
    },
  }
]);
