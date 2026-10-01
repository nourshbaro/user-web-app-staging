import { SubpageShell } from "@/components/SubpageShell";
import { AppText, SkeletonGroup, SkeletonText, StatePanel } from "@/components/foundation";
import { useI18n } from "@/i18n/I18nProvider";
import { spacing } from "@/lib/designTokens";
import { legalService } from "@/services/legal";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

/**
 * One legal document (v3 Privacy / Terms layout) showing the backend text from
 * `legalService` exactly as published. The app writes no legal copy of its
 * own: while it loads or if it fails, only a state panel is shown.
 */
export function LegalDocumentScreen({ document }: { document: "privacy" | "terms" }) {
  const i18n = useI18n();
  const [state, setState] = useState<{ loading: boolean; error: boolean; content: string | null }>({ loading: true, error: false, content: null });

  const activeRef = useRef(true);
  const fetchDocument = useCallback(() => {
    (document === "privacy" ? legalService.privacyPolicy() : legalService.termsOfUse())
      .then((content) => {
        if (activeRef.current) setState({ loading: false, error: false, content });
      })
      .catch(() => {
        if (activeRef.current) setState({ loading: false, error: true, content: null });
      });
  }, [document]);

  useEffect(() => {
    activeRef.current = true;
    fetchDocument();
    return () => {
      activeRef.current = false;
    };
  }, [fetchDocument]);

  const retry = () => {
    setState({ loading: true, error: false, content: null });
    fetchDocument();
  };

  const paragraphs = (state.content ?? "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);

  return (
    <SubpageShell title={i18n.t(`legal.${document}.title`)} backLabel={i18n.t("legal.title")} fallback="/legal">
      {state.loading ? (
        <SkeletonGroup label={i18n.t("legal.loading")}>
          <SkeletonText lines={8} />
        </SkeletonGroup>
      ) : state.error ? (
        <StatePanel
          variant="error"
          title={i18n.t(`legal.${document}.error`)}
          message={i18n.t("legal.error.message")}
          action={{ label: i18n.t("common.retry"), onPress: retry }}
        />
      ) : (
        <View style={local.body}>
          {paragraphs.map((paragraph, index) => (
            <AppText key={index} variant="body" style={local.paragraph}>{paragraph}</AppText>
          ))}
        </View>
      )}
    </SubpageShell>
  );
}

const local = {
  body: { gap: spacing.md, paddingHorizontal: spacing.xs },
  paragraph: { lineHeight: 23 },
};
