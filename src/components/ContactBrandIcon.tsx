import Svg, { Circle, Path, Rect } from "react-native-svg";

export type ContactBrand = "instagram" | "facebook" | "x";

export function ContactBrandIcon({ brand, color, size = 20 }: { brand: ContactBrand; color: string; size?: number }) {
  if (brand === "instagram") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke={color} strokeWidth="2" /><Circle cx="12" cy="12" r="4" fill="none" stroke={color} strokeWidth="2" /><Circle cx="17.4" cy="6.7" r="1.2" fill={color} /></Svg>;
  }
  if (brand === "facebook") {
    return <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Path fill={color} d="M13.7 22v-8h2.8l.42-3.2H13.7V8.75c0-.93.26-1.56 1.62-1.56H17V4.33c-.29-.04-1.28-.13-2.43-.13-2.4 0-4.04 1.46-4.04 4.15v2.45H7.8V14h2.73v8h3.17Z" /></Svg>;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Path fill={color} d="M18.24 2h3.31l-7.23 8.26L22.83 22h-6.66l-5.21-6.82L4.99 22H1.68l7.73-8.84L1.25 2h6.83l4.71 6.23L18.24 2Zm-1.16 17.93h1.83L7.08 3.97H5.11l11.97 15.96Z" /></Svg>;
}
