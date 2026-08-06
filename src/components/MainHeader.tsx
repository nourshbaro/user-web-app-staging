import { Image, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeaderActions } from "@/components/HeaderActions";
import { colors, useTheme } from "@/components/ui";

export function MainHeader() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, 14);

  return (
    <View style={[local.surface, { width }]}>
      <View
        pointerEvents="none"
        style={{ height: topInset, marginTop: -topInset, backgroundColor: theme.colors.panel }}
      />
      <View style={[local.header, { width, backgroundColor: theme.colors.panel, borderBottomColor: theme.colors.line }]}>
        <Image source={require("../../assets/images/lfa-logo.png")} style={local.logo} resizeMode="contain" />
        <HeaderActions />
      </View>
    </View>
  );
}

const local = {
  surface: {
    alignSelf: "center" as const,
  },
  header: {
    minHeight: 76,
    marginTop: -14,
    alignSelf: "center" as const,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: "#FFFFFF",
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  logo: {
    width: 60,
    height: 54,
  },
};
