import { View } from "react-native";
import { MatchesList } from "@/components/MatchesList";
import { Screen, useResponsive } from "@/components/ui";

export default function MatchesScreen() {
  const responsive = useResponsive();

  return (
    <Screen>
      {/* MatchesList renders the tab header inside its scroll view. */}
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <MatchesList />
      </View>
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
};
