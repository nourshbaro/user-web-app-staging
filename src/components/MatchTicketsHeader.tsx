import { AppHeader } from "@/components/AppHeader";

/** Match Details adapter over the same AppHeader used across the application. */
export function MatchTicketsHeader({ title, subtitle, onBack }: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  cartCount: number;
  secondsLeft: number;
  compact?: boolean;
}) {
  return <AppHeader title={title} subtitle={subtitle} onBack={onBack} hideCart showTimer showCartWithTimer />;
}
