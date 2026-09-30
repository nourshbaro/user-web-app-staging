import { useTheme } from "@/components/ui";
import { storageUrl } from "@/lib/config";
import { fontStyleFor } from "@/lib/fontFamilies";
import { teamInitials } from "@/lib/matchDiscovery";
import type { ApiTeam } from "@/types";
import { useState } from "react";
import { Image, Text, View } from "react-native";

/**
 * Team crest from the backend logo, with an initials fallback when the team
 * has no logo or it fails to load. Decorative: the owning card carries the
 * accessible match description.
 *
 * v3 draws a round \`--crest\` plate with a hairline ring. The initials
 * fallback uses exactly that; a real logo keeps a fixed light plate (still
 * v3's ring) so dark club artwork stays legible in the dark theme.
 */
export function TeamCrest({ team, size = 48, onHero = false }: { team: ApiTeam | null | undefined; size?: number; onHero?: boolean }) {
  const theme = useTheme();
  const logoUrl = storageUrl(team?.logo);
  const [failed, setFailed] = useState(false);
  const showLogo = Boolean(logoUrl) && !failed;

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: showLogo ? theme.colors.scanSurface : onHero ? "rgba(255,255,255,0.07)" : theme.colors.crest,
        borderWidth: 1,
        borderColor: onHero ? "rgba(255,255,255,0.16)" : theme.colors.border,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {showLogo ? (
        <Image
          source={{ uri: logoUrl }}
          style={{ width: size * 0.78, height: size * 0.78 }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text
          numberOfLines={1}
          style={[
            { color: onHero ? theme.colors.onHero : theme.colors.secondary, fontSize: Math.max(7, Math.round(size * 0.26)) },
            fontStyleFor("text", "700", "latin"),
          ]}
        >
          {teamInitials(team)}
        </Text>
      )}
    </View>
  );
}
