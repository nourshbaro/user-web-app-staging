import { AppText } from "@/components/foundation";
import { Button, useTheme } from "@/components/ui";
import { SymbolView } from "expo-symbols";
import { createContext, type PropsWithChildren, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";

type AlertVariant = "info" | "confirm" | "destructive";
type AlertOptions = {
  title: string;
  message: string;
  variant?: AlertVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  dismissible?: boolean;
};

type ActiveAlert = AlertOptions & { resolve: (accepted: boolean) => void };
const AlertDialogContext = createContext<{ showAlert: (options: AlertOptions) => Promise<boolean> } | null>(null);

export function AlertDialogProvider({ children }: PropsWithChildren) {
  const theme = useTheme();
  const [active, setActive] = useState<ActiveAlert | null>(null);
  const activeRef = useRef<ActiveAlert | null>(null);
  const showAlert = useCallback((options: AlertOptions) => new Promise<boolean>((resolve) => {
    activeRef.current?.resolve(false);
    const next = { ...options, resolve };
    activeRef.current = next;
    setActive(next);
  }), []);
  const finish = useCallback((accepted: boolean) => {
    const current = activeRef.current;
    if (!current) return;
    activeRef.current = null;
    setActive(null);
    current.resolve(accepted);
  }, []);
  const dismissible = active?.dismissible ?? active?.variant === "info";
  const value = useMemo(() => ({ showAlert }), [showAlert]);

  return (
    <AlertDialogContext.Provider value={value}>
      {children}
      <Modal visible={Boolean(active)} transparent animationType="fade" onRequestClose={() => { if (dismissible) finish(false); }}>
        {/* v3 dialog: dark scrim, card surface, title / message, stacked full-width actions (primary first). */}
        <Pressable style={styles.backdrop} onPress={() => { if (dismissible) finish(false); }} accessibilityRole="button" accessibilityLabel={dismissible ? "Dismiss alert" : undefined}>
          <Pressable accessibilityViewIsModal onPress={(event) => event.stopPropagation()} style={[styles.dialog, { backgroundColor: theme.colors.surface, boxShadow: "0px 24px 60px rgba(0,0,0,0.35)" }]}>
            {dismissible ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => finish(false)} style={styles.close}>
                <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={19} tintColor={theme.colors.textMuted} fallback={<View />} />
              </Pressable>
            ) : null}
            <AppText variant="bodyStrong" accessibilityRole="header" style={[styles.title, dismissible && styles.titleWithClose]}>{active?.title}</AppText>
            <AppText variant="meta" tone="muted" style={styles.message}>{active?.message}</AppText>
            <View style={styles.actions}>
              <Button
                title={active?.confirmLabel ?? "OK"}
                variant={active?.variant === "destructive" ? "danger" : "primary"}
                onPress={() => finish(true)}
              />
              {active?.variant !== "info" ? (
                <Button title={active?.cancelLabel ?? "Cancel"} variant="tonal" onPress={() => finish(false)} />
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </AlertDialogContext.Provider>
  );
}

export function useAlertDialog() {
  const value = useContext(AlertDialogContext);
  if (!value) throw new Error("useAlertDialog must be used inside AlertDialogProvider");
  return value;
}

// v3: scrim rgba(0,0,0,.45), padding 36; dialog radius 16 (iOS) / 28 (Android), padding 22 20 16, gap 10.
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", padding: 36, alignItems: "center", justifyContent: "center" },
  dialog: { width: "100%", maxWidth: 420, borderRadius: Platform.OS === "android" ? 28 : 16, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 16, gap: 10 },
  close: { position: "absolute", end: 6, top: 6, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 1 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  titleWithClose: { paddingEnd: 32 },
  message: { fontSize: 14, lineHeight: 20 },
  actions: { gap: 8, marginTop: 10 },
});
