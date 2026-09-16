const { withPodfile } = require('@expo/config-plugins');
const { mergeContents, removeGeneratedContents } = require('@expo/config-plugins/build/utils/generateCode');

// React Native Firebase's static-linkage Swift pods (e.g. FirebaseCoreInternal,
// which depends on GoogleUtilities) require CocoaPods modular headers to build
// as static libraries. Neither @react-native-firebase/app nor
// @react-native-firebase/messaging expose a config-plugin option for this, so
// it's applied directly here, anchored the same way RNFirebase's own
// `disableSPM` Podfile mod is (right after `prepare_react_native_project!`,
// before any `target` block) so both directives are visible to CocoaPods
// before pods are declared.
const TAG = 'withFirebaseModularHeaders';
const ANCHOR = /prepare_react_native_project!/;
const FLAG = 'use_modular_headers!';

function setPodfileModularHeaders(src, enabled = true) {
  if (!enabled) {
    return removeGeneratedContents(src, TAG) ?? src;
  }

  return mergeContents({
    src,
    newSrc: FLAG,
    tag: TAG,
    anchor: ANCHOR,
    offset: 1,
    comment: '#',
  }).contents;
}

const withFirebaseModularHeaders = (config) => {
  return withPodfile(config, (config) => {
    config.modResults.contents = setPodfileModularHeaders(config.modResults.contents, true);
    return config;
  });
};

module.exports = withFirebaseModularHeaders;
