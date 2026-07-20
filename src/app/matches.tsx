import { View } from "react-native";
import { MainHeader } from "@/components/MainHeader";
import { MatchesList } from "@/components/MatchesList";
import { Screen, useResponsive } from "@/components/ui";

export default function MatchesScreen() {
  const responsive = useResponsive();

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <MainHeader />
        <MatchesList filterable />
      </View>
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
};
