import { Image, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive, useTheme } from "@/components/ui";

export function UnderConstruction503() {
  const theme = useTheme();
  const responsive = useResponsive();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: theme.colors.bg,
          paddingTop: Math.max(insets.top, 24),
          paddingBottom: Math.max(insets.bottom, 24),
        },
      ]}
    >
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          {
            width: Math.min(responsive.contentWidth, 380),
            backgroundColor: theme.colors.panel,
            borderColor: theme.colors.line,
          },
        ]}
      >
        <Image
          source={require("../../../assets/images/lfa-logo.png")}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Lebanese Football Association"
        />
        <View
          style={[
            styles.heroIcon,
            { backgroundColor: theme.colors.panelSoft },
          ]}
        >
          <SymbolView
            name={{
              ios: "wrench.and.screwdriver",
              android: "construction",
              web: "construction",
            }}
            size={32}
            tintColor={theme.colors.primary}
          />
        </View>
        <Text style={[styles.code, { color: theme.colors.muted }]}>LFA Tickets</Text>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: theme.colors.ink }]}
        >
          System under construction
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.secondary }]}>The admin has temporarily paused access. Please try again later.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  card: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    padding: 32,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
  logo: { width: 68, height: 68, marginBottom: 24 },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  code: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
