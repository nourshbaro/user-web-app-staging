import { Redirect } from "expo-router";

/**
 * Legacy route. v3 replaces "About" with Legal (privacy policy and terms of
 * use, both from `legalService`); old links land there.
 */
export default function AboutRedirect() {
  return <Redirect href="/legal" />;
}
