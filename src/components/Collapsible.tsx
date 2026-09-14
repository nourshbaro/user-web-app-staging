import { useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { SymbolView } from "expo-symbols";
import { useRef } from "react";
import {
  LayoutAnimation,
  Pressable,
  Text,
  View,
  type ViewStyle,
} from "react-native";

const EXPAND_ANIMATION = LayoutAnimation.create(
  220,
  "easeInEaseOut",
  "opacity",
);

/**
 * A restrained expand/collapse disclosure section (Stadium block, Ticket
 * Holders summary, ...). Uses `LayoutAnimation` rather than a gesture
 * library so it stays cheap and doesn't fight nested horizontal
 * scrollers/gesture surfaces (stadium map, seat picker). Respects the
 * platform "reduce motion" accessibility setting.
 */
export function Collapsible({
  title,
  subtitle,
  expanded,
  onToggle,
  headerRight,
  children,
  style,
}: {
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const wasExpandedRef = useRef(expanded);

  const toggle = () => {
    if (!reducedMotion) LayoutAnimation.configureNext(EXPAND_ANIMATION);
    wasExpandedRef.current = !expanded;
    onToggle();
  };

  return (
    <View style={style}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        style={local.header}
      >
        <View style={local.headerCopy}>
          <Text style={[local.title, { color: theme.colors.ink }]}>
            {title}
          </Text>
          {subtitle ? <Text style={theme.styles.muted}>{subtitle}</Text> : null}
        </View>
        {headerRight}
        <Chevron expanded={expanded} color={theme.colors.muted} />
      </Pressable>
      {expanded ? <View style={local.body}>{children}</View> : null}
    </View>
  );
}

function Chevron({ expanded, color }: { expanded: boolean; color: string }) {
  return (
    <SymbolView
      name={{ ios: expanded ? "chevron.up" : "chevron.down", android: expanded ? "expand_less" : "expand_more", web: expanded ? "expand_less" : "expand_more" }}
      size={20}
      tintColor={color}
      fallback={<View />}
    />
  );
}

const local = {
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    minHeight: 24,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: "800" as const },
  body: { paddingTop: 10 },
};
