import { Redirect } from "expo-router";

/**
 * Legacy primary route. The Tournament tab became Competitions; existing links
 * (ads, auth return routes, deep links) to `/tournament` still land on the one
 * competitions experience instead of a second, competing screen.
 */
export default function TournamentRedirect() {
  return <Redirect href="/competitions" />;
}
