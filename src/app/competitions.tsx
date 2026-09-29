import { View } from "react-native";
import { StatePanel } from "@/components/foundation";
import { TabHeader } from "@/components/TabHeader";
import { Screen, useResponsive } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { spacing } from "@/lib/designTokens";

/**
 * Competitions tab — navigation shell only in this checkpoint. Competition
 * lists, standings and fixtures arrive in a later batch, fed by the confirmed
 * `/competitions`, `/competitions/{id}/standings` and
 * `/competitions/{id}/matches` endpoints; nothing is mocked here.
 */
export default function CompetitionsScreen() {
  const responsive = useResponsive();
  const { t } = useI18n();

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <TabHeader title={t("competitions.title")} />
        <View style={local.content}>
          <StatePanel
            variant="unavailable"
            title={t("competitions.comingSoon.title")}
            message={t("competitions.comingSoon.message")}
          />
        </View>
      </View>
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const, gap: spacing.md },
  content: { flex: 1, justifyContent: "center" as const },
};
