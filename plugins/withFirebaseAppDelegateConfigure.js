const { withAppDelegate } = require('@expo/config-plugins');

// Expo SDK 58 moved React Native startup out of AppDelegate.swift into
// SceneDelegate. @react-native-firebase/app 26.4.0 anchors its
// `FirebaseApp.configure()` insertion on `factory.startReactNative(` (or the
// old `self.moduleName = ...`), neither of which exists in the SDK 58
// AppDelegate, so it adds `import FirebaseCore` and then only emits a prebuild
// *warning* ("Unable to determine correct Firebase insertion point"). The app
// then launches with no default Firebase app and every `getMessaging()` throws
// "No Firebase App '[DEFAULT]' has been created".
//
// This plugin configures Firebase at the start of
// `application(_:didFinishLaunchingWithOptions:)`, right before the call to
// `super.application(...)`, so it runs before Expo's app-delegate subscribers
// and before any scene starts React Native. It is idempotent, so it becomes a
// no-op if a future RNFirebase release inserts the call itself. It fails
// prebuild instead of warning when it cannot find its anchor, so this
// regression cannot reappear silently.
const CONFIGURE = 'FirebaseApp.configure()';
const IMPORT = 'import FirebaseCore';
const SUPER_CALL = /^([ \t]*)return super\.application\(\s*application,\s*didFinishLaunchingWithOptions:\s*launchOptions\s*\)/m;

function addFirebaseConfigureToSwiftAppDelegate(contents) {
  let next = contents;

  if (!/^[ \t]*import\s+FirebaseCore[ \t]*$/m.test(next)) {
    const firstImport = /^[ \t]*(?:internal\s+|public\s+)?import\b[^\r\n]*$/m.exec(next);
    next = firstImport
      ? `${next.slice(0, firstImport.index)}${IMPORT}\n${next.slice(firstImport.index)}`
      : `${IMPORT}\n${next}`;
  }

  if (next.includes(CONFIGURE)) return next;

  const match = SUPER_CALL.exec(next);
  if (!match) {
    throw new Error(
      '[withFirebaseAppDelegateConfigure] Could not find `return super.application(application, '
        + 'didFinishLaunchingWithOptions: launchOptions)` in AppDelegate.swift, and FirebaseApp.configure() '
        + 'is not present. Without it the app has no default Firebase app at launch. Update this plugin '
        + 'for the new AppDelegate template.',
    );
  }

  const indent = match[1];
  const insertion = `${indent}// @generated withFirebaseAppDelegateConfigure\n${indent}${CONFIGURE}\n`;
  return `${next.slice(0, match.index)}${insertion}${next.slice(match.index)}`;
}

const withFirebaseAppDelegateConfigure = (config) =>
  withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      if (!config.modResults.contents.includes('[FIRApp configure]')) {
        throw new Error(
          `[withFirebaseAppDelegateConfigure] Unsupported AppDelegate language "${config.modResults.language}" `
            + 'and [FIRApp configure] is missing.',
        );
      }
      return config;
    }
    config.modResults.contents = addFirebaseConfigureToSwiftAppDelegate(config.modResults.contents);
    return config;
  });

module.exports = withFirebaseAppDelegateConfigure;
module.exports.addFirebaseConfigureToSwiftAppDelegate = addFirebaseConfigureToSwiftAppDelegate;
