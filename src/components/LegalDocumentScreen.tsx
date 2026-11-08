import { SubpageShell } from "@/components/SubpageShell";
import { AppText, SkeletonGroup, SkeletonText, StatePanel } from "@/components/foundation";
import { useI18n } from "@/i18n/I18nProvider";
import { spacing } from "@/lib/designTokens";
import { parseLegalDocument, type LegalBlock, type LegalRun } from "@/lib/legalDocument";
import { failureReason } from "@/lib/userFacingError";
import { legalService } from "@/services/legal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

/**
 * One legal document (v3 Privacy / Terms layout) showing the backend text from
 * `legalService` exactly as published. The app writes no legal copy of its
 * own: while it loads or if it fails, only a state panel is shown.
 */
export function LegalDocumentScreen({ document }: { document: "privacy" | "terms" }) {
  const i18n = useI18n();
  // `reason`: what the backend (or the transport) said about a failed read.
  const [state, setState] = useState<{ loading: boolean; error: boolean; content: string | null; reason?: string | null }>({ loading: true, error: false, content: null });

  const activeRef = useRef(true);
  const fetchDocument = useCallback(() => {
    (document === "privacy" ? legalService.privacyPolicy() : legalService.termsOfUse())
      .then((content) => {
        if (activeRef.current) setState({ loading: false, error: false, content });
      })
      .catch((err) => {
        if (activeRef.current) setState({ loading: false, error: true, content: null, reason: failureReason(err) });
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

  const blocks = useMemo(() => parseLegalDocument(state.content ?? ""), [state.content]);

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
          message={state.reason ?? i18n.t("legal.error.message")}
          action={{ label: i18n.t("common.retry"), onPress: retry }}
        />
      ) : (
        <View style={local.body}>
          {blocks.map((block, index) => (
            <LegalBlockView key={index} block={block} first={index === 0} />
          ))}
        </View>
      )}
    </SubpageShell>
  );
}

function LegalBlockView({ block, first }: { block: LegalBlock; first: boolean }) {
  if (block.kind === "heading") {
    return (
      <AppText variant="sectionTitle" accessibilityRole="header" style={first ? null : local.heading}>
        {block.runs.map((run) => run.text).join("")}
      </AppText>
    );
  }
  if (block.kind === "list") {
    return (
      <View role="list" style={local.list}>
        {block.items.map((item, index) => (
          <View key={index} role="listitem" style={local.listItem}>
            <AppText variant="body" tone="muted" style={[local.paragraph, local.marker]}>
              {block.ordered ? `${index + 1}.` : "•"}
            </AppText>
            <AppText variant="body" style={[local.paragraph, local.itemText]}>
              <LegalRuns runs={item} />
            </AppText>
          </View>
        ))}
      </View>
    );
  }
  return (
    <AppText variant="body" style={local.paragraph}>
      <LegalRuns runs={block.runs} />
    </AppText>
  );
}

/** Bold runs nest as `bodyStrong` so the script-aware font family carries the weight. */
function LegalRuns({ runs }: { runs: LegalRun[] }) {
  return runs.map((run, index) =>
    run.strong ? (
      <AppText key={index} variant="bodyStrong" style={local.paragraph}>{run.text}</AppText>
    ) : (
      run.text
    ),
  );
}

const local = {
  body: { gap: spacing.md, paddingHorizontal: spacing.xs },
  heading: { marginTop: spacing.md },
  paragraph: { lineHeight: 23 },
  list: { gap: spacing.sm },
  listItem: { flexDirection: "row" as const, gap: spacing.sm },
  marker: { minWidth: 18 },
  itemText: { flex: 1 },
};
