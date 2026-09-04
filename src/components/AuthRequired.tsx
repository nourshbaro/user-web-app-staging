import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { Button, useTheme } from "@/components/ui";

export function AuthRequired() {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
      <View style={[styles.icon, { backgroundColor: theme.colors.panelSoft }]}>
        <SymbolView
          name={{ ios: "person.crop.circle.badge.exclamationmark", android: "lock_person", web: "lock_person" }}
          size={32}
          tintColor={theme.colors.primary}
          fallback={<Text style={{ color: theme.colors.primary }}>LFA</Text>}
        />
      </View>
      <Text style={[styles.title, { color: theme.colors.ink }]}>Sign in required</Text>
      <Text style={[styles.detail, { color: theme.colors.muted }]}>Sign in to access your LFA account and tickets.</Text>
      <View style={styles.action}><Button title="Sign In" onPress={() => router.push("/auth")} /></View>
    </View>
  );
}

const styles = StyleSheet.create({ card: { width: "100%", maxWidth: 480, alignSelf: "center", borderWidth: 1, borderRadius: 12, padding: 22, alignItems: "center", gap: 9 }, icon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 }, title: { fontSize: 20, fontWeight: "900" }, detail: { maxWidth: 310, fontSize: 14, lineHeight: 20, textAlign: "center" }, action: { minWidth: 180, marginTop: 8 } });
