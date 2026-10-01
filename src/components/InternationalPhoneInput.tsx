import { useTheme } from "@/components/ui";
import { SheetDismissHandle } from "@/components/SheetDismissHandle";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
    PHONE_COUNTRIES,
    createEmptyPhoneValue,
    getPhoneCallingCode,
    getPhoneCountryName,
    updateNationalPhone,
    type PhoneValue,
} from "@/lib/phoneNumber";
import { useMemo, useState } from "react";
import { SymbolView } from "expo-symbols";
import {
    FlatList,
    Keyboard,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface InternationalPhoneInputProps {
    value: PhoneValue;
    error?: string;
    disabled?: boolean;
    onChange: (value: PhoneValue) => void;
}

export function InternationalPhoneInput({
    value,
    error,
    disabled = false,
    onChange,
}: InternationalPhoneInputProps) {
    const theme = useTheme();
    const reducedMotion = useReducedMotion();
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const phoneCountryName = getPhoneCountryName(value.phoneCountry);
    const callingCode = getPhoneCallingCode(value.phoneCountry);

    const filteredCountries = useMemo(() => {
        const query = searchQuery.trim().toLocaleLowerCase("en");

        if (!query) return PHONE_COUNTRIES;

        const callingCodeQuery = query.replace(/^\+/, "");

        return PHONE_COUNTRIES.filter((option) => {
            return (
                option.name.toLocaleLowerCase("en").includes(query) ||
                option.phoneCountry.toLocaleLowerCase("en").includes(query) ||
                option.callingCode.includes(callingCodeQuery)
            );
        });
    }, [searchQuery]);

    const closeSelector = () => {
        Keyboard.dismiss();
        setSelectorOpen(false);
        setSearchQuery("");
    };

    return (
        <View style={styles.container}>
            <Text style={[styles.label, { color: theme.colors.ink }]}>
                Phone
            </Text>

            <View style={styles.phoneRow}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Phone country, ${phoneCountryName}, calling code +${callingCode}`}
                    accessibilityHint="Opens the phone-country selector."
                    accessibilityState={{
                        expanded: selectorOpen,
                        disabled,
                    }}
                    aria-expanded={selectorOpen}
                    aria-disabled={disabled}
                    disabled={disabled}
                    onPress={() => {
                        Keyboard.dismiss();
                        setSelectorOpen(true);
                    }}
                    style={({ pressed }) => [
                        styles.countryButton,
                        {
                            backgroundColor: theme.colors.panel,
                            borderColor: error ? theme.colors.danger : theme.colors.line,
                        },
                        disabled && styles.disabled,
                        pressed && !disabled && styles.pressed,
                    ]}
                >
                    <Text
                        numberOfLines={1}
                        style={[styles.countryCode, { color: theme.colors.ink }]}
                    >
                        {value.phoneCountry}
                    </Text>
                    <Text
                        numberOfLines={1}
                        style={[styles.callingCode, { color: theme.colors.muted }]}
                    >
                        +{callingCode}
                    </Text>
                    <Text
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={[styles.chevron, { color: theme.colors.muted }]}
                    >
                        ▾
                    </Text>
                </Pressable>

                <View
                    style={[
                        styles.numberField,
                        {
                            backgroundColor: theme.colors.panel,
                            borderColor: error ? theme.colors.danger : theme.colors.line,
                        },
                        disabled && styles.disabled,
                    ]}
                >
                    <Text
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={[styles.numberPrefix, { color: theme.colors.muted }]}
                    >
                        +{callingCode}
                    </Text>

                    <TextInput
                        accessibilityLabel="Phone number"
                        accessibilityHint={`Enter the national phone number for ${phoneCountryName}, or paste a complete international phone number.`}
                        accessibilityState={{ disabled }}
                        value={value.phoneNationalValue}
                        editable={!disabled}
                        keyboardType="phone-pad"
                        textContentType="telephoneNumber"
                        autoComplete="tel-national"
                        placeholder="National number"
                        placeholderTextColor={theme.colors.muted}
                        onChangeText={(input) => {
                            onChange(updateNationalPhone(input, value.phoneCountry));
                        }}
                        style={[styles.numberInput, { color: theme.colors.ink }]}
                    />
                </View>
            </View>

            {error ? (
                <Text
                    accessibilityRole="alert"
                    style={[styles.errorText, { color: theme.colors.danger }]}
                >
                    {error}
                </Text>
            ) : (
                <Text style={[styles.hintText, { color: theme.colors.muted }]}>
                    Select a phone country and enter its national number.
                </Text>
            )}

            <Modal
                animationType={reducedMotion ? "fade" : "slide"}
                transparent
                visible={selectorOpen}
                statusBarTranslucent
                onRequestClose={closeSelector}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close phone-country selector"
                    onPress={closeSelector}
                    style={[
                        styles.modalBackdrop,
                        { backgroundColor: "rgba(15, 23, 42, 0.56)" },
                    ]}
                >
                    <SafeAreaView
                        onTouchEnd={(event) => event.stopPropagation()}
                        accessibilityViewIsModal
                        accessibilityLabel="Phone-country selector"
                        style={[
                            styles.modalPanel,
                            {
                                backgroundColor: theme.colors.panel,
                                borderColor: theme.colors.line,
                            },
                        ]}
                    >
                        <SheetDismissHandle onDismiss={closeSelector} color={theme.colors.muted} />
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHeading}>
                                <Text style={[styles.modalTitle, { color: theme.colors.ink }]}>
                                    Phone country
                                </Text>
                                <Text style={[styles.modalSubtitle, { color: theme.colors.muted }]}>
                                    Choose the calling code for this phone number.
                                </Text>
                            </View>

                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Close phone-country selector"
                                onPress={closeSelector}
                                hitSlop={8}
                                style={({ pressed }) => [
                                    styles.closeButton,
                                    {
                                        backgroundColor: theme.colors.panelSoft,
                                        borderColor: theme.colors.line,
                                    },
                                    pressed && styles.pressed,
                                ]}
                            >
                                <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={19} tintColor={theme.colors.ink} fallback={<View />} />
                            </Pressable>
                        </View>

                        <TextInput
                            accessibilityLabel="Search phone countries"
                            autoFocus={Platform.OS !== "web"}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder="Search country, ISO code, or calling code"
                            placeholderTextColor={theme.colors.muted}
                            style={[
                                styles.searchInput,
                                {
                                    backgroundColor: theme.colors.panel,
                                    borderColor: theme.colors.line,
                                    color: theme.colors.ink,
                                },
                            ]}
                        />

                        <FlatList
                            data={filteredCountries}
                            keyExtractor={(option) => option.phoneCountry}
                            keyboardShouldPersistTaps="handled"
                            initialNumToRender={24}
                            maxToRenderPerBatch={24}
                            windowSize={7}
                            contentContainerStyle={styles.countryList}
                            ListEmptyComponent={
                                <Text style={[styles.emptyText, { color: theme.colors.muted }]}>
                                    No matching phone countries.
                                </Text>
                            }
                            renderItem={({ item }) => {
                                const selected = item.phoneCountry === value.phoneCountry;

                                return (
                                    <Pressable
                                        accessibilityRole="radio"
                                        accessibilityLabel={`${item.name}, calling code +${item.callingCode}`}
                                        accessibilityState={{ checked: selected }}
                                        aria-checked={selected}
                                        onPress={() => {
                                            if (!selected) {
                                                onChange(createEmptyPhoneValue(item.phoneCountry));
                                            }
                                            closeSelector();
                                        }}
                                        style={({ pressed }) => [
                                            styles.countryOption,
                                            {
                                                borderColor: selected
                                                    ? theme.colors.primary
                                                    : theme.colors.line,
                                                backgroundColor: selected
                                                    ? theme.colors.panelSoft
                                                    : theme.colors.panel,
                                            },
                                            pressed && styles.pressed,
                                        ]}
                                    >
                                        <View style={styles.countryOptionText}>
                                            <Text
                                                numberOfLines={1}
                                                style={[
                                                    styles.countryName,
                                                    { color: theme.colors.ink },
                                                ]}
                                            >
                                                {item.name}
                                            </Text>
                                            <Text
                                                style={[
                                                    styles.countryIso,
                                                    { color: theme.colors.muted },
                                                ]}
                                            >
                                                {item.phoneCountry}
                                            </Text>
                                        </View>

                                        <Text
                                            style={[
                                                styles.optionCallingCode,
                                                {
                                                    color: selected
                                                        ? theme.colors.primary
                                                        : theme.colors.ink,
                                                },
                                            ]}
                                        >
                                            +{item.callingCode}
                                        </Text>
                                    </Pressable>
                                );
                            }}
                        />
                    </SafeAreaView>
                </Pressable>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: 6,
    },
    label: {
        fontSize: 13,
        fontWeight: "700",
    },
    phoneRow: {
        flexDirection: "row",
        alignItems: "stretch",
        gap: 8,
    },
    countryButton: {
        minWidth: 104,
        minHeight: 48,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 11,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
    countryCode: {
        fontSize: 13,
        fontWeight: "800",
    },
    callingCode: {
        fontSize: 13,
        fontWeight: "600",
    },
    chevron: {
        fontSize: 12,
    },
    numberField: {
        minWidth: 0,
        minHeight: 48,
        flex: 1,
        borderWidth: 1,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        paddingStart: 12,
    },
    numberPrefix: {
        fontSize: 15,
        fontWeight: "700",
        marginEnd: 6,
    },
    numberInput: {
        minWidth: 0,
        minHeight: 46,
        flex: 1,
        paddingHorizontal: 0,
        paddingEnd: 12,
        fontSize: 15,
    },
    hintText: {
        fontSize: 12,
        lineHeight: 17,
    },
    errorText: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "600",
    },
    disabled: {
        opacity: 0.56,
    },
    pressed: {
        opacity: 0.76,
    },
    modalBackdrop: {
        flex: 1,
        justifyContent: "flex-end",
    },
    modalPanel: {
        width: "100%",
        maxHeight: "86%",
        minHeight: "64%",
        borderTopWidth: 1,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
        gap: 12,
    },
    modalHeader: {
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    modalHeading: {
        minWidth: 0,
        flex: 1,
        gap: 2,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: "900",
    },
    modalSubtitle: {
        fontSize: 12,
        lineHeight: 17,
    },
    closeButton: {
        minWidth: 64,
        minHeight: 44,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    closeButtonText: {
        fontSize: 13,
        fontWeight: "800",
    },
    searchInput: {
        minHeight: 48,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        fontSize: 15,
    },
    countryList: {
        gap: 8,
        paddingBottom: 16,
    },
    countryOption: {
        minHeight: 52,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 13,
        paddingVertical: 9,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    countryOptionText: {
        minWidth: 0,
        flex: 1,
        gap: 2,
    },
    countryName: {
        fontSize: 14,
        fontWeight: "700",
    },
    countryIso: {
        fontSize: 11,
        fontWeight: "700",
    },
    optionCallingCode: {
        fontSize: 14,
        fontWeight: "800",
    },
    emptyText: {
        paddingVertical: 28,
        textAlign: "center",
        fontSize: 14,
    },
});
