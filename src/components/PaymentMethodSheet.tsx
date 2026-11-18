import { BottomSheetModal } from "@/components/BottomSheetModal";
import { useTheme } from "@/components/ui";
import type { CheckoutSubmitRequest } from "@/types";
import { SymbolView } from "expo-symbols";
import { Image, Pressable, Text, View } from "react-native";

/** A method the payer chooses; "free" is never chosen, it follows from a zero total. */
export type PaymentMethodOption = Exclude<CheckoutSubmitRequest["payment_method"], "free">;

const OPTIONS: {
  id: PaymentMethodOption;
  title: string;
  detail: string;
  icon: any;
}[] = [
  {
    id: "cybersource",
    title: "Card",
    detail: "Visa secure checkout.",
    icon: { ios: "creditcard", android: "credit_card", web: "credit_card" },
  },
  {
    id: "blue",
    title: "BLUE Wallet",
    detail: "Redirect to Blue to complete payment.",
    icon: {
      ios: "wallet.pass",
      android: "account_balance_wallet",
      web: "account_balance_wallet",
    },
  },
];

export function PaymentMethodIcon({
  method,
  size = 24,
}: {
  method: PaymentMethodOption;
  size?: number;
}) {
  const theme = useTheme();
  if (method === "blue") {
    return (
      <Image
        source={require("../../assets/images/blue-logo.png")}
        resizeMode="contain"
        style={{ width: size + 8, height: size }}
        accessibilityLabel="BLUE"
      />
    );
  }
  return (
    <SymbolView
      name={{ ios: "creditcard", android: "credit_card", web: "credit_card" }}
      size={size}
      tintColor={theme.colors.ink}
      fallback={<View />}
    />
  );
}

/**
 * Payment method picker — a dismissible bottom sheet (swipe down / backdrop
 * tap / X, see BottomSheetModal) listing only the methods this app actually
 * supports. Selecting a method closes the sheet automatically.
 */
export function PaymentMethodSheet({
  visible,
  onClose,
  selected,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  selected: PaymentMethodOption | null;
  onSelect: (method: PaymentMethodOption) => void;
}) {
  const theme = useTheme();

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title="Select payment method"
    >
      <View style={local.list}>
        {OPTIONS.map((option) => {
          const active = selected === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => {
                onSelect(option.id);
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.title}
              style={[
                local.option,
                {
                  backgroundColor: theme.colors.panel,
                  borderColor: theme.colors.line,
                },
                active && {
                  borderColor: theme.colors.primary,
                  backgroundColor: "rgba(200,16,46,0.06)",
                },
              ]}
            >
              <View
                style={[
                  local.icon,
                  { backgroundColor: theme.colors.panelSoft },
                  active &&
                    option.id !== "blue" && {
                      backgroundColor: theme.colors.primary,
                    },
                ]}
              >
                {option.id === "blue" ? (
                  <PaymentMethodIcon method="blue" size={22} />
                ) : (
                  <SymbolView
                    name={option.icon}
                    size={19}
                    tintColor={active ? "#FFFFFF" : theme.colors.ink}
                    fallback={<View />}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[local.title, { color: theme.colors.ink }]}>
                  {option.title}
                </Text>
                <Text style={theme.styles.muted}>{option.detail}</Text>
              </View>
              {active ? (
                <View
                  style={[
                    local.check,
                    { backgroundColor: theme.colors.primary },
                  ]}
                >
                  <SymbolView
                    name={{ ios: "checkmark", android: "check", web: "check" }}
                    size={15}
                    tintColor="#FFFFFF"
                    fallback={<View />}
                  />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </BottomSheetModal>
  );
}

const local = {
  list: { gap: 10, paddingVertical: 12 },
  option: {
    minHeight: 74,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  title: { fontSize: 15, fontWeight: "900" as const },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  checkText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" as const },
};
