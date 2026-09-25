import { PhysicalLayout } from "@/components/foundation/direction";
import { useTheme } from "@/components/ui";
import { layout, radius, spacing } from "@/lib/designTokens";
import type { PropsWithChildren } from "react";
import { View } from "react-native";

/**
 * Visual building blocks for tickets (Phase 5 consumers). Layout only: no
 * ticket data, status interpretation or QR logic lives here.
 */
export function TicketCardShell({ children }: PropsWithChildren) {
  const theme = useTheme();
  return (
    <View style={[local.shell, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      {children}
    </View>
  );
}

export function TicketCardSection({ children, emphasis = false }: PropsWithChildren<{ emphasis?: boolean }>) {
  const theme = useTheme();
  return (
    <View style={[local.section, emphasis && { backgroundColor: theme.colors.hero }]}>
      {children}
    </View>
  );
}

/** Tear-line divider with side notches; purely decorative. */
export function TicketPerforation() {
  const theme = useTheme();
  const notch = [local.notch, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }];
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={local.perforation}>
      <View style={[notch, local.notchStart]} />
      <View style={[local.dash, { borderColor: theme.colors.divider }]} />
      <View style={[notch, local.notchEnd]} />
    </View>
  );
}

/**
 * High-contrast, never-mirrored frame for a scannable code. The caller passes
 * the backend-provided QR image as children; this frame never creates QR data.
 */
export function TicketQrFrame({ children }: PropsWithChildren) {
  const theme = useTheme();
  return (
    <PhysicalLayout style={[local.qrFrame, { backgroundColor: theme.colors.scanSurface, borderColor: theme.colors.border }]}>
      {children}
    </PhysicalLayout>
  );
}

const NOTCH = 18;

const local = {
  shell: {
    width: "100%" as const,
    maxWidth: layout.readableWidth,
    alignSelf: "center" as const,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden" as const,
  },
  section: { padding: layout.cardPadding, gap: spacing.sm },
  perforation: { height: NOTCH, flexDirection: "row" as const, alignItems: "center" as const },
  notch: { width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, borderWidth: 1 },
  notchStart: { marginStart: -NOTCH / 2 },
  notchEnd: { marginEnd: -NOTCH / 2 },
  dash: { flex: 1, borderTopWidth: 1, borderStyle: "dashed" as const, marginHorizontal: spacing.xs },
  qrFrame: {
    alignSelf: "center" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
};
