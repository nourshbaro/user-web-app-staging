import type { ComponentType } from "react";
import { View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { AuthRequired } from "@/components/AuthRequired";
import { MainHeader } from "@/components/MainHeader";
import { Loading, Screen, useResponsive } from "@/components/ui";

// Do not mount customer screens (or their effects) until the session is ready.
export function withAuthRequired(Component: ComponentType) {
  return function AuthenticatedScreen() {
    const auth = useAuth();
    const responsive = useResponsive();
    if (!auth.isReady) return <Loading />;
    if (!auth.isAuthenticated) return (
      <Screen>
        <View style={{ flex: 1, alignSelf: "center", width: responsive.contentWidth }}>
          <MainHeader />
          <AuthRequired />
        </View>
      </Screen>
    );
    return <Component key={auth.userCacheKey} />;
  };
}
