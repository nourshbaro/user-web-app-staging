import { useTheme } from "@/components/ui";
import { storageUrl } from "@/lib/config";
import { teamInitials } from "@/lib/matchDiscovery";
import type { ApiTeam } from "@/types";
import { useState } from "react";
import { Image, Text, View } from "react-native";

/**
 * Team crest from the backend logo, with an initials fallback when the team
 * has no logo or it fails to load. Decorative: the owning card carries the
 * accessible match description.
 */
export function TeamCrest({ team, size = 48 }: { team: ApiTeam | null | undefined; size?: number }) {
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
        // Crests are artwork on a fixed light plate so they read in both themes.
        backgroundColor: theme.colors.scanSurface,
        borderWidth: 1,
        borderColor: theme.colors.border,
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
          style={{ color: theme.colors.tones.brand.fg, fontSize: Math.round(size * 0.28), fontWeight: "900" }}
        >
          {teamInitials(team)}
        </Text>
      )}
    </View>
  );
}
