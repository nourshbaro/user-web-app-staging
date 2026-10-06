import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { SymbolView } from "expo-symbols";
import { forwardRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

export type PasswordFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  editable: boolean;
  placeholder?: string;
  /** "password" for the current password (autofill), "newPassword" for a new one. */
  contentType: "password" | "newPassword";
  revealLabel: string;
  concealLabel: string;
} & Pick<React.ComponentProps<typeof TextInput>, "returnKeyType" | "onSubmitEditing">;

/**
 * LFA Screen v3 password input (`chpw` / `delete_verify`): 13/500 muted label,
 * a 52pt card field with radius 14, a hairline inset border that turns into a
 * 2pt red ring on focus. Keeps the production show / hide control.
 */
export const PasswordField = forwardRef<TextInput, PasswordFieldProps>(function PasswordField(
  { label, value, onChangeText, editable, placeholder, contentType, revealLabel, concealLabel, ...inputProps },
  ref,
) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={local.wrap}>
      <AppText variant="meta" tone="muted" style={local.label}>{label}</AppText>
      <View
        style={[
          local.field,
          { backgroundColor: theme.colors.surface, borderColor: focused ? theme.colors.actionPrimary : theme.colors.border, borderWidth: focused ? 2 : 1 },
        ]}
      >
        <TextInput
          ref={ref}
          {...inputProps}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          editable={editable}
          textContentType={contentType}
          autoComplete={contentType === "password" ? "current-password" : "new-password"}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[local.input, { color: theme.colors.textStrong }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? concealLabel : revealLabel}
          disabled={!editable}
          aria-disabled={!editable}
          onPress={() => setVisible((current) => !current)}
          hitSlop={8}
          style={local.toggle}
        >
          <SymbolView
            accessible={false}
            name={{ ios: visible ? "eye.slash" : "eye", android: visible ? "visibility_off" : "visibility", web: visible ? "visibility_off" : "visibility" }}
            size={20}
            tintColor={theme.colors.textMuted}
            fallback={<View />}
          />
        </Pressable>
      </View>
    </View>
  );
});

const local = {
  wrap: { gap: 6 },
  label: { fontSize: 13, lineHeight: 17, fontWeight: "500" as const, paddingStart: 4 },
  field: { minHeight: 52, borderRadius: 14, flexDirection: "row" as const, alignItems: "center" as const },
  input: { flex: 1, minHeight: 48, paddingStart: 16, fontSize: 17 },
  toggle: { width: 48, minHeight: 48, alignItems: "center" as const, justifyContent: "center" as const },
};
