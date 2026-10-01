import { FlowHeader } from "@/components/FlowHeader";
import { Screen, useResponsive } from "@/components/ui";
import { layout, spacing } from "@/lib/designTokens";
import { Stack, router } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

/**
 * v3 pushed-screen shell (Settings, Legal, Contact…): the flow header with a
 * back label and a readable scrolling column. Back returns through history,
 * or to `fallback` when the screen was opened directly.
 */
export function SubpageShell({
  title,
  backLabel,
  fallback,
  children,
}: {
  title: string;
  backLabel: string;
  fallback: "/profile" | "/legal";
  children: ReactNode;
}) {
  const responsive = useResponsive();
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false, title }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <FlowHeader
          title={title}
          backLabel={backLabel}
          onBack={() => {
            if (router.canGoBack()) router.back();
            else router.replace(fallback);
          }}
        />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={local.content}>
          {children}
        </ScrollView>
      </View>
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  content: { width: "100%" as const, maxWidth: layout.readableWidth + 160, alignSelf: "center" as const, gap: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.xxxl },
};
