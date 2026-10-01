import type { ComponentType } from "react";
import { View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { AuthRequired } from "@/components/AuthRequired";
import { MainHeader } from "@/components/MainHeader";
import { TabHeader } from "@/components/TabHeader";
import { Loading, Screen, useResponsive } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages/en";

// Do not mount customer screens (or their effects) until the session is ready.
// A primary tab passes its title so the signed-out state keeps the v3 tab header.
export function withAuthRequired(Component: ComponentType, tabTitle?: MessageKey) {
  return function AuthenticatedScreen() {
    const auth = useAuth();
    const responsive = useResponsive();
    const { t } = useI18n();
    if (!auth.isReady) return <Loading />;
    if (!auth.isAuthenticated) return (
      <Screen>
        <View style={{ flex: 1, alignSelf: "center", width: responsive.contentWidth }}>
          {tabTitle ? <TabHeader title={t(tabTitle)} /> : <MainHeader />}
          <AuthRequired />
        </View>
      </Screen>
    );
    return <Component key={auth.userCacheKey} />;
  };
}
