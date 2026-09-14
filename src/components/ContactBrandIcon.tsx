import Svg, { Circle, Path, Rect } from "react-native-svg";

export type ContactBrand = "instagram" | "facebook" | "x" | "whatsapp";

export function ContactBrandIcon({
  brand,
  color,
  size = 20,
}: {
  brand: ContactBrand;
  color: string;
  size?: number;
}) {
  if (brand === "instagram") {
    return (
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="5"
          fill="none"
          stroke={color}
          strokeWidth="2"
        />
        <Circle
          cx="12"
          cy="12"
          r="4"
          fill="none"
          stroke={color}
          strokeWidth="2"
        />
        <Circle cx="17.4" cy="6.7" r="1.2" fill={color} />
      </Svg>
    );
  }
  if (brand === "facebook") {
    return (
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Path
          fill={color}
          d="M13.7 22v-8h2.8l.42-3.2H13.7V8.75c0-.93.26-1.56 1.62-1.56H17V4.33c-.29-.04-1.28-.13-2.43-.13-2.4 0-4.04 1.46-4.04 4.15v2.45H7.8V14h2.73v8h3.17Z"
        />
      </Svg>
    );
  }
  if (brand === "whatsapp") {
    return (
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Path
          fill={color}
          d="M12.04 2a9.84 9.84 0 0 0-8.52 14.76L2 22l5.38-1.41A9.9 9.9 0 1 0 12.04 2Zm0 17.98a8.13 8.13 0 0 1-4.15-1.14l-.3-.18-3.2.84.85-3.11-.2-.32a8.17 8.17 0 1 1 7 3.91Zm4.48-6.11c-.25-.12-1.45-.72-1.68-.8-.22-.08-.38-.12-.54.12-.16.25-.63.8-.77.96-.14.17-.29.19-.53.07-.25-.13-1.04-.39-1.98-1.23a7.4 7.4 0 0 1-1.37-1.7c-.14-.25-.02-.38.1-.5.12-.1.25-.28.37-.43.13-.14.17-.24.25-.4.08-.17.04-.31-.02-.44-.06-.12-.55-1.32-.75-1.8-.2-.48-.4-.41-.54-.42h-.47c-.17 0-.43.06-.66.3-.22.25-.86.85-.86 2.06 0 1.22.89 2.39 1.01 2.55.12.16 1.74 2.66 4.22 3.73.59.25 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.45-.6 1.66-1.17.2-.58.2-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z"
        />
      </Svg>
    );
  }
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        fill={color}
        d="M18.24 2h3.31l-7.23 8.26L22.83 22h-6.66l-5.21-6.82L4.99 22H1.68l7.73-8.84L1.25 2h6.83l4.71 6.23L18.24 2Zm-1.16 17.93h1.83L7.08 3.97H5.11l11.97 15.96Z"
      />
    </Svg>
  );
}
