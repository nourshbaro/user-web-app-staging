import { useTheme } from "@/components/ui";
import { SymbolView } from "expo-symbols";
import { createContext, type PropsWithChildren, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

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
        <Pressable style={styles.backdrop} onPress={() => { if (dismissible) finish(false); }} accessibilityRole="button" accessibilityLabel={dismissible ? "Dismiss alert" : undefined}>
          <Pressable accessibilityViewIsModal onPress={(event) => event.stopPropagation()} style={[styles.dialog, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
            {dismissible ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => finish(false)} style={styles.close}>
                <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={19} tintColor={theme.colors.ink} fallback={<View />} />
              </Pressable>
            ) : null}
            <Text style={[styles.title, { color: theme.colors.ink }]}>{active?.title}</Text>
            <Text style={[styles.message, { color: theme.colors.muted }]}>{active?.message}</Text>
            <View style={styles.actions}>
              {active?.variant !== "info" ? (
                <Pressable accessibilityRole="button" accessibilityLabel={active?.cancelLabel ?? "Cancel"} onPress={() => finish(false)} style={[styles.button, { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}>
                  <Text style={[styles.buttonText, { color: theme.colors.ink }]}>{active?.cancelLabel ?? "Cancel"}</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel={active?.confirmLabel ?? "OK"} onPress={() => finish(true)} style={[styles.button, { backgroundColor: active?.variant === "destructive" ? theme.colors.danger : theme.colors.primary, borderColor: "transparent" }]}>
                <Text style={[styles.buttonText, { color: "#FFFFFF" }]}>{active?.confirmLabel ?? "OK"}</Text>
              </Pressable>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.58)", padding: 20, alignItems: "center", justifyContent: "center" },
  dialog: { width: "100%", maxWidth: 440, borderRadius: 22, borderWidth: 1, padding: 20, gap: 12 },
  close: { position: "absolute", end: 8, top: 8, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 1 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "900", paddingEnd: 32 },
  message: { fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 6 },
  button: { minWidth: 100, minHeight: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", flexShrink: 1 },
  buttonText: { fontSize: 15, fontWeight: "800", textAlign: "center" },
});
