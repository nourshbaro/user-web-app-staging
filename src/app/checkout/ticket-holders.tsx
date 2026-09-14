import { AppHeader } from "@/components/AppHeader";
import { useResponsive, useTheme } from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useAuth } from "@/context/AuthContext";
import { useTicketHolders } from "@/context/TicketHoldersContext";
import { useToast } from "@/context/ToastContext";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { SymbolView } from "expo-symbols";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function firstParam(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

function TicketHoldersScreen() {
  const { ticketSlots, holderNames, setHolderName, initializeFirstHolder } = useTicketHolders();
  const auth = useAuth();
  const toast = useToast();
  const theme = useTheme();
  const responsive = useResponsive();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const params = useLocalSearchParams<{ edit?: string | string[] }>();
  const isEditMode = firstParam(params.edit) === "1";
  const returnToParent = useCallback(() => {
    if (isEditMode) {
      router.dismissTo("/checkout");
      return;
    }
    router.replace("/cart");
  }, [isEditMode]);
  const [stepIndex, setStepIndex] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [contentMotion] = useState(() => new Animated.Value(1));
  const [progressMotion] = useState(() => new Animated.Value(0));
  const [direction, setDirection] = useState(1);
  const [showNameError, setShowNameError] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const stepsRef = useRef<ScrollView>(null);

  useEffect(() => { if (!ticketSlots.length) router.replace("/cart"); }, [ticketSlots.length]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      returnToParent();
      return true;
    });
    return () => subscription.remove();
  }, [returnToParent]);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const clampedIndex = Math.min(stepIndex, Math.max(0, ticketSlots.length - 1));
  const slot = ticketSlots[clampedIndex];
  const total = ticketSlots.length;
  const isFirst = clampedIndex === 0;
  const isLast = clampedIndex === total - 1;
  const currentValue = slot ? holderNames[slot.key] ?? "" : "";
  const isCurrentComplete = Boolean(currentValue.trim());
  const progress = total ? (clampedIndex + 1) / total : 0;
  const firstInvalidIndex = useMemo(() => ticketSlots.findIndex((item) => !holderNames[item.key]?.trim()), [holderNames, ticketSlots]);

  useEffect(() => {
    const firstSlot = ticketSlots[0];
    const profileName = auth.user?.name?.trim();
    if (!isEditMode && firstSlot && profileName) initializeFirstHolder(firstSlot.key, profileName);
  }, [auth.user?.name, initializeFirstHolder, isEditMode, ticketSlots]);

  useEffect(() => {
    if (reducedMotion) { contentMotion.setValue(1); progressMotion.setValue(progress); return; }
    contentMotion.setValue(0);
    Animated.parallel([
      Animated.timing(contentMotion, { toValue: 1, duration: 210, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(progressMotion, { toValue: progress, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();
  }, [clampedIndex, contentMotion, progress, progressMotion, reducedMotion]);

  const transitionTo = useCallback((next: number) => {
    const target = Math.max(0, Math.min(next, total - 1));
    const movement = target >= clampedIndex ? 1 : -1;
    if (reducedMotion) {
      setDirection(movement);
      setShowNameError(false);
      setStepIndex(target);
      return;
    }
    setDirection(-movement);
    Animated.timing(contentMotion, { toValue: 0, duration: 90, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      setDirection(movement);
      setShowNameError(false);
      setStepIndex(target);
    });
  }, [clampedIndex, contentMotion, reducedMotion, total]);
  const showValidation = useCallback((invalidIndex: number) => {
    toast.showToast({ variant: "warning", title: "Ticket holder required", message: `Enter the holder name for ticket ${invalidIndex + 1}.` });
    if (invalidIndex === clampedIndex) {
      setShowNameError(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      transitionTo(invalidIndex);
    }
  }, [clampedIndex, toast, transitionTo]);
  const goToHolder = useCallback((requestedIndex: number) => {
    const target = Math.max(0, Math.min(requestedIndex, total - 1));
    if (target === clampedIndex) return true;
    if (target < clampedIndex) { transitionTo(target); return true; }
    const invalidIndex = ticketSlots.slice(0, target).findIndex((item) => !holderNames[item.key]?.trim());
    if (invalidIndex !== -1) { showValidation(invalidIndex); return false; }
    transitionTo(target);
    return true;
  }, [clampedIndex, holderNames, showValidation, ticketSlots, total, transitionTo]);
  const finishOrAdvance = useCallback(() => {
    if (!isLast) { goToHolder(clampedIndex + 1); return; }
    if (!currentValue.trim()) { showValidation(clampedIndex); return; }
    if (firstInvalidIndex !== -1) { showValidation(firstInvalidIndex); return; }
    if (isEditMode) router.dismissTo("/checkout"); else router.replace("/checkout");
  }, [clampedIndex, currentValue, firstInvalidIndex, goToHolder, isEditMode, isLast, showValidation]);
  const swipeGesture = useMemo(() => Gesture.Pan()
    .enabled(!inputFocused)
    .activeOffsetX([-24, 24])
    .failOffsetY([-18, 18])
    .cancelsTouchesInView(false)
    .runOnJS(true)
    // RNGH retains this callback; it does not read a React ref during render.
    // eslint-disable-next-line react-hooks/refs
    .onEnd((event) => {
      if (Math.abs(event.translationX) < 54 && Math.abs(event.velocityX) < 420) return;
      goToHolder(clampedIndex + (event.translationX < 0 ? 1 : -1));
    }), [clampedIndex, goToHolder, inputFocused]);

  useEffect(() => {
    if (total < 2) return;
    const circleStride = 43;
    const visibleWidth = Math.max(120, responsive.contentWidth - 100);
    stepsRef.current?.scrollTo({ x: Math.max(0, clampedIndex * circleStride - visibleWidth / 2 + 17), animated: !reducedMotion });
  }, [clampedIndex, reducedMotion, responsive.contentWidth, total]);

  if (!slot) return null;
  const translateX = contentMotion.interpolate({ inputRange: [0, 1], outputRange: [18 * direction, 0] });

  return (
    <View style={[local.screen, { backgroundColor: theme.colors.bg, paddingTop: Math.max(insets.top, 12) }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <KeyboardAvoidingView style={local.keyboardView} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          <AppHeader title={isEditMode ? "Edit Ticket Holders" : "Ticket Holder Info"} hideCart showTimer onBack={returnToParent} />

          <GestureDetector gesture={swipeGesture}>
            <View style={local.gestureArea}>
              <View style={local.statusRow}>
                <Text style={[local.statusLabel, { color: theme.colors.muted }]}>Ticket Holder {clampedIndex + 1}/{total}</Text>
                <Animated.Text style={[local.status, { color: isCurrentComplete ? theme.colors.green : theme.colors.muted, opacity: contentMotion }]}>{isCurrentComplete ? "Complete" : "Incomplete"}</Animated.Text>
              </View>
              <View style={[local.progressTrack, { backgroundColor: theme.colors.line }]}> 
                <Animated.View style={[local.progressFill, { backgroundColor: theme.colors.primary, width: progressMotion.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
              </View>

              <View style={local.stepperRow}>
                <Pressable disabled={isFirst} onPress={() => goToHolder(clampedIndex - 1)} accessibilityRole="button" accessibilityLabel="Previous ticket" accessibilityState={{ disabled: isFirst }} style={local.arrowButton}><SymbolView name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} size={25} tintColor={isFirst ? theme.colors.line : theme.colors.ink} fallback={<View />} /></Pressable>
                <ScrollView ref={stepsRef} horizontal showsHorizontalScrollIndicator={false} scrollEnabled={total > 1} style={local.stepsScroll} contentContainerStyle={[local.steps, total === 1 && local.stepsSingle]}>
                  {ticketSlots.map((item, index) => {
                    const active = index === clampedIndex;
                    const complete = Boolean(holderNames[item.key]?.trim());
                    return <Pressable key={item.key} onPress={() => goToHolder(index)} accessibilityLabel={`Ticket ${index + 1}${complete ? ", complete" : ""}`} style={[local.stepCircle, { backgroundColor: active ? theme.colors.primary : complete ? `${theme.colors.green}28` : theme.colors.panelSoft, borderColor: active ? theme.colors.primary : complete ? theme.colors.green : theme.colors.line }]}><Text style={[local.stepNumber, { color: active ? "#FFFFFF" : complete ? theme.colors.green : theme.colors.muted }]}>{index + 1}</Text></Pressable>;
                  })}
                </ScrollView>
                <Pressable disabled={isLast} onPress={() => goToHolder(clampedIndex + 1)} accessibilityRole="button" accessibilityLabel="Next ticket" accessibilityState={{ disabled: isLast }} style={local.arrowButton}><SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={25} tintColor={isLast ? theme.colors.line : theme.colors.ink} fallback={<View />} /></Pressable>
              </View>

              <ScrollView style={local.body} contentContainerStyle={local.bodyContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Animated.View style={[local.card, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line, opacity: contentMotion, transform: [{ translateX }] }]}> 
              <View style={local.cardTitleRow}>
                <View style={[local.iconWrap, { backgroundColor: `${theme.colors.primary}16` }]}><SymbolView name={{ ios: "person.fill", android: "person", web: "person" }} size={18} tintColor={theme.colors.primary} /></View>
                <View style={local.ticketCopy}>
                  <Text style={[local.ticketTitle, { color: theme.colors.ink }]}>Ticket #{clampedIndex + 1}</Text>
                  <Text numberOfLines={1} style={[local.zone, { color: theme.colors.muted }]}>{slot.zoneName}</Text>
                </View>
              </View>
              {slot.matchTitle ? <Text numberOfLines={1} style={[local.match, { color: theme.colors.muted }]}>{slot.matchTitle}</Text> : null}
              <View style={[local.inputSurface, { backgroundColor: theme.colors.panelSoft, borderColor: showNameError ? theme.colors.danger : theme.colors.line }]}>
                <TextInput ref={inputRef} value={currentValue} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} onChangeText={(value) => { setHolderName(slot.key, value); if (value.trim()) setShowNameError(false); }} placeholder="Holder Name" placeholderTextColor={theme.colors.muted} autoCapitalize="words" autoCorrect={false} autoFocus style={[local.input, { color: theme.colors.ink }]} returnKeyType={isLast ? "done" : "next"} onSubmitEditing={finishOrAdvance} />
                {currentValue ? <Pressable onPress={() => setHolderName(slot.key, "")} accessibilityRole="button" accessibilityLabel="Clear holder name" hitSlop={8} style={local.clearButton}><SymbolView name={{ ios: "xmark.circle.fill", android: "cancel", web: "cancel" }} size={22} tintColor={theme.colors.muted} fallback={<View />} /></Pressable> : null}
              </View>
              {showNameError ? <Text accessibilityRole="alert" style={[local.validationText, { color: theme.colors.danger }]}>Ticket holder name is required.</Text> : null}
                </Animated.View>
              </ScrollView>
            </View>
          </GestureDetector>

          <View style={[local.footer, { backgroundColor: theme.colors.bg, borderTopColor: theme.colors.line, paddingBottom: keyboardVisible ? 10 : Math.max(insets.bottom, 10) }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous ticket" accessibilityState={{ disabled: isFirst }} disabled={isFirst} onPress={() => goToHolder(clampedIndex - 1)} style={({ pressed }) => [local.footerButton, local.previousButton, { backgroundColor: theme.isDark ? "#24262A" : "#31343A", opacity: isFirst ? 0.45 : pressed ? 0.78 : 1 }]}><SymbolView name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} size={18} tintColor={isFirst ? theme.colors.muted : "#FFFFFF"} fallback={<View />} /><Text style={[local.footerButtonText, { color: isFirst ? theme.colors.muted : "#FFFFFF" }]}>Previous</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={isLast ? (isEditMode ? "Save ticket holders" : "Continue to checkout") : "Next ticket"} onPress={finishOrAdvance} style={({ pressed }) => [local.footerButton, local.nextButton, { backgroundColor: theme.colors.primary, opacity: pressed ? 0.82 : 1 }]}><Text style={local.footerButtonText}>{isLast ? (isEditMode ? "Save" : "Checkout") : "Next Ticket"}</Text><SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={18} tintColor="#FFFFFF" fallback={<View />} /></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const local = {
  screen: { flex: 1, alignItems: "center" as const }, keyboardView: { flex: 1, width: "100%" as const, alignItems: "center" as const }, shell: { flex: 1, alignSelf: "center" as const, paddingHorizontal: 14 }, gestureArea: { flex: 1 },
  statusRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, marginTop: 10 }, statusLabel: { fontSize: 14, fontWeight: "700" as const }, status: { fontSize: 13, fontWeight: "800" as const },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" as const, marginTop: 6 }, progressFill: { height: "100%" as const, borderRadius: 3 },
  stepperRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, marginVertical: 14 }, stepsScroll: { flex: 1 }, steps: { flexGrow: 1, alignItems: "center" as const, gap: 9, paddingHorizontal: 4 }, stepsSingle: { justifyContent: "center" as const }, stepCircle: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center" as const, justifyContent: "center" as const }, stepNumber: { fontSize: 13, fontWeight: "900" as const }, arrowButton: { width: 44, height: 44, alignItems: "center" as const, justifyContent: "center" as const },
  body: { flex: 1 }, bodyContent: { flexGrow: 1, paddingBottom: 12 }, card: { borderRadius: 22, borderWidth: 1, padding: 18, gap: 12, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  cardTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 }, iconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: "center" as const, justifyContent: "center" as const }, ticketCopy: { flex: 1, minWidth: 0 }, ticketTitle: { fontSize: 20, fontWeight: "900" as const }, zone: { fontSize: 13, marginTop: 2 }, match: { fontSize: 13 },
  inputSurface: { minHeight: 58, borderRadius: 13, borderWidth: 1, flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: 14 }, input: { flex: 1, minWidth: 0, fontSize: 17, paddingVertical: 12 }, clearButton: { width: 44, height: 44, alignItems: "center" as const, justifyContent: "center" as const },
  validationText: { fontSize: 12, fontWeight: "700" as const, marginTop: -4 },
  footer: { marginHorizontal: -14, paddingHorizontal: 14, paddingTop: 11, flexDirection: "row" as const, gap: 10, borderTopWidth: 1 }, footerButton: { minHeight: 48, borderRadius: 14, alignItems: "center" as const, justifyContent: "center" as const, flexDirection: "row" as const, gap: 5, paddingHorizontal: 10 }, footerButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" as const }, previousButton: { flex: 0.8 }, nextButton: { flex: 1.35 },
};

export default withAuthRequired(TicketHoldersScreen);
