import { BarlowCondensed_500Medium } from "@expo-google-fonts/barlow-condensed/500Medium";
import { BarlowCondensed_600SemiBold } from "@expo-google-fonts/barlow-condensed/600SemiBold";
import { BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed/700Bold";
import { IBMPlexSans_400Regular } from "@expo-google-fonts/ibm-plex-sans/400Regular";
import { IBMPlexSans_500Medium } from "@expo-google-fonts/ibm-plex-sans/500Medium";
import { IBMPlexSans_600SemiBold } from "@expo-google-fonts/ibm-plex-sans/600SemiBold";
import { IBMPlexSans_700Bold } from "@expo-google-fonts/ibm-plex-sans/700Bold";
import { useFonts } from "expo-font";
import { useEffect } from "react";
import { LATIN_FONT_FAMILIES, setCustomFontsLoaded } from "@/lib/fontFamilies";

/**
 * Registers the bundled font files (runtime `expo-font` loading, so it also
 * works in Expo Go and existing development builds without a native rebuild).
 * Only the weights the typography roles use are bundled. Keys are the family
 * names in `LATIN_FONT_FAMILIES`.
 */
const FONT_FILES = {
  [LATIN_FONT_FAMILIES.text["400"]]: IBMPlexSans_400Regular,
  [LATIN_FONT_FAMILIES.text["500"]]: IBMPlexSans_500Medium,
  [LATIN_FONT_FAMILIES.text["600"]]: IBMPlexSans_600SemiBold,
  [LATIN_FONT_FAMILIES.text["700"]]: IBMPlexSans_700Bold,
  [LATIN_FONT_FAMILIES.display["500"]]: BarlowCondensed_500Medium,
  [LATIN_FONT_FAMILIES.display["600"]]: BarlowCondensed_600SemiBold,
  [LATIN_FONT_FAMILIES.display["700"]]: BarlowCondensed_700Bold,
};

/**
 * True once loading has settled, successfully or not. A failure is not fatal:
 * the families are simply not used and text renders in the platform font.
 */
export function useAppFonts() {
  const [loaded, error] = useFonts(FONT_FILES);

  useEffect(() => {
    if (error) console.warn("Custom fonts failed to load; using the platform font.", error);
  }, [error]);

  // Set before the first render that depends on it (the app waits for `settled`).
  setCustomFontsLoaded(loaded && !error);
  return loaded || Boolean(error);
}
