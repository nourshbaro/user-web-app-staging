import { Text, View } from "react-native";
import { MainHeader } from "@/components/MainHeader";
import { Card, Screen, colors, styles, useResponsive, useTheme } from "@/components/ui";

export default function TournamentScreen() {
  const responsive = useResponsive();
  const theme = useTheme();

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <MainHeader />
        <View style={local.content}>
          <Card>
            <View style={local.comingSoon}>
              <Text style={[local.title, { color: theme.colors.ink }]}>Coming Soon</Text>
              <Text style={[styles.muted, local.copy]}>Tournament information will be available here.</Text>
            </View>
          </Card>
        </View>
      </View>
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  content: { flex: 1, justifyContent: "center" as const },
  comingSoon: {
    minHeight: 220,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
  },
  title: { color: colors.ink, fontSize: 28, fontWeight: "900" as const },
  copy: { textAlign: "center" as const },
};
