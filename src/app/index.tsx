import { View } from "react-native";
import { HomeFeed } from "@/components/HomeFeed";
import { Screen, useResponsive } from "@/components/ui";

export default function HomeScreen() {
  const responsive = useResponsive();

  return (
    <Screen>
      {/* HomeFeed renders the brand header inside its scroll view (v3: the header scrolls with the feed). */}
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <HomeFeed />
      </View>
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
};
