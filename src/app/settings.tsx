import { AppHeader } from "@/components/AppHeader";
import { Button, Card, Screen, useResponsive, useTheme } from "@/components/ui";
import { Stack } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function SettingsScreen() {
  const responsive = useResponsive();
  const theme = useTheme();

  return (
    <Screen>
      <Stack.Screen options={{ title: "Settings" }} />
      <View style={[styles.shell, { width: responsive.contentWidth }]}>
        <AppHeader title="Settings" subtitle="Account and app preferences" />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Card>
            <Text style={theme.styles.h2}>Appearance</Text>
            <Text style={theme.styles.muted}>Current theme: {theme.isDark ? "Dark" : "Light"}</Text>
            <Button title={`Use ${theme.isDark ? "light" : "dark"} theme`} variant="secondary" onPress={theme.toggleTheme} />
          </Card>
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, alignSelf: "center" },
  content: { gap: 14, paddingBottom: 28 },
});
