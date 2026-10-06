import { FlowHeader } from "@/components/FlowHeader";
import { useResponsive, useTheme } from "@/components/ui";
import { layout, spacing } from "@/lib/designTokens";
import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Pushed account screen (LFA Screen v3 `chpw` / `delete_verify`): the flow
 * header, a scrolling column of fields (padding 4 20 16, gap 12) and the
 * translucent bottom action bar (padding 12 16 10, top hairline) that stays
 * above the keyboard.
 */
export function AccountFormShell({
  title,
  backLabel,
  onBack,
  backDisabled,
  footer,
  children,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  backDisabled?: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  const responsive = useResponsive();
  const insets = useSafeAreaInsets();
  const width = Math.min(responsive.contentWidth, layout.readableWidth + 160);
  return (
    <View style={[local.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false, title }} />
      <KeyboardAvoidingView style={local.keyboard} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={{ width: responsive.contentWidth, alignSelf: "center" }}>
          <FlowHeader title={title} backLabel={backLabel} onBack={onBack} backDisabled={backDisabled} />
        </View>
        <ScrollView
          style={local.body}
          contentContainerStyle={[local.content, { width }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        <View
          style={[
            local.bar,
            { backgroundColor: theme.colors.bar, borderTopColor: theme.colors.hairline, paddingBottom: 10 + insets.bottom },
          ]}
        >
          <View style={[local.barContent, { width }]}>{footer}</View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const local = {
  screen: { flex: 1 },
  keyboard: { flex: 1 },
  body: { flex: 1 },
  // `contentWidth` already leaves the 16pt page gutter: +4 here gives v3's 20pt field inset.
  content: { alignSelf: "center" as const, paddingTop: spacing.xs, paddingHorizontal: spacing.xs, paddingBottom: 16, gap: 12 },
  // The bar spans the screen; its content column already sits inside the 16pt gutter (v3 padding 12 16 10).
  bar: { paddingTop: 12, borderTopWidth: 1 },
  barContent: { alignSelf: "center" as const, gap: 8 },
};
