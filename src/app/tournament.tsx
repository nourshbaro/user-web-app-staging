import { View } from "react-native";
import { MainHeader } from "@/components/MainHeader";
import { StatePanel } from "@/components/foundation";
import { Screen, useResponsive } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";

export default function TournamentScreen() {
  const responsive = useResponsive();
  const { t } = useI18n();

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <MainHeader />
        <View style={local.content}>
          <StatePanel
            variant="unavailable"
            title={t("tournament.comingSoon.title")}
            message={t("tournament.comingSoon.message")}
          />
        </View>
      </View>
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  content: { flex: 1, justifyContent: "center" as const },
};
