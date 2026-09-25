import { View } from "react-native";
import { MainHeader } from "@/components/MainHeader";
import { HomeFeed } from "@/components/HomeFeed";
import { Screen, useResponsive } from "@/components/ui";

export default function HomeScreen() {
  const responsive = useResponsive();

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <MainHeader />
        <HomeFeed />
      </View>
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
};
