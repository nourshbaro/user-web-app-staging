import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, styles, useResponsive } from "@/components/ui";

type ToastVariant = "success" | "error" | "info" | "warning";

type ToastInput = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  duration?: number;
};

type ToastState = ToastInput & {
  id: number;
  variant: ToastVariant;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
  hideToast: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const variantStyles: Record<ToastVariant, { accent: string; bg: string }> = {
  success: { accent: colors.green, bg: "#F0FAF5" },
  error: { accent: colors.primary, bg: "#FFF1F3" },
  info: { accent: colors.secondary, bg: "#F4F7FB" },
  warning: { accent: colors.gold, bg: "#FFF8E5" },
};

export function ToastProvider({ children }: PropsWithChildren) {
  const responsive = useResponsive();
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(1);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = () => setToast(null);

  const showToast = (input: ToastInput) => {
    const message = input.message.trim();
    if (!message) return;
    setToast({
      ...input,
      message,
      id: nextId.current++,
      variant: input.variant ?? "info",
      duration: input.duration ?? 3600,
    });
  };

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!toast) return;
    timeoutRef.current = setTimeout(() => setToast(null), toast.duration);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [toast]);

  const value = useMemo(() => ({ showToast, hideToast }), []);
  const variant = toast ? variantStyles[toast.variant] : variantStyles.info;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={local.overlay}>
          <Pressable
            onPress={hideToast}
            style={[
              local.toast,
              {
                width: Math.min(responsive.contentWidth, 560),
                backgroundColor: variant.bg,
                borderColor: variant.accent,
              },
            ]}
          >
            <View style={[local.accent, { backgroundColor: variant.accent }]} />
            <View style={local.copy}>
              {toast.title ? <Text style={local.title}>{toast.title}</Text> : null}
              <Text style={styles.text}>{toast.message}</Text>
            </View>
            <Text style={local.close}>x</Text>
          </Pressable>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

const local = {
  overlay: {
    position: "absolute" as const,
    top: 14,
    left: 0,
    right: 0,
    zIndex: 1000,
    alignItems: "center" as const,
    paddingHorizontal: 16,
  },
  toast: {
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  accent: { width: 5, alignSelf: "stretch" as const },
  copy: { flex: 1, gap: 2, paddingHorizontal: 12, paddingVertical: 10 },
  title: { color: colors.ink, fontSize: 14, fontWeight: "900" as const },
  close: { color: colors.muted, fontSize: 16, fontWeight: "900" as const, paddingHorizontal: 12 },
};
