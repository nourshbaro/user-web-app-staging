import { useMemo } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme, type ThemeColors } from "@/components/ui";
import {
  getTicketMatchName,
  getTicketOrderReference,
} from "@/lib/profilePortal";

export type ProfileDetailItem = Record<string, any>;

export type ProfileDetailState = {
  type: "order" | "ticket";
  title: string;
  item: ProfileDetailItem;
  pdfId?: string;
} | null;

type ProfileDetailModalProps = {
  detail: ProfileDetailState;
  downloadingPdf: boolean;
  onClose: () => void;
  onDownloadPdf: (orderId?: string) => void;
};

export function ProfileDetailModal({
  detail,
  downloadingPdf,
  onClose,
  onDownloadPdf,
}: ProfileDetailModalProps) {
  const local = useProfileDetailStyles();
  const theme = useTheme();
  const item = detail?.item;
  const normalized =
    detail?.type === "order" && isRecord(item?.order) ? item.order : item;
  const ticketOrderReference =
    detail?.type === "ticket" ? getTicketOrderReference(item) : null;
  const ticketMatchName =
    detail?.type === "ticket" ? getTicketMatchName(item) : null;
  const entries = normalized
    ? Object.entries(normalized).filter(([key, value]) =>
        shouldShowDetailField(key, value)
      )
    : [];
  const items = Array.isArray(item?.items)
    ? item.items.filter(isRecord)
    : [];
  const tickets = Array.isArray(item?.tickets)
    ? item.tickets.filter(isRecord)
    : [];

  return (
    <Modal
      visible={Boolean(detail)}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={local.modalOverlay}>
        <View
          style={[
            local.modalSheet,
            { backgroundColor: theme.colors.panel },
          ]}
        >
          <View
            style={[
              local.modalHeader,
              { borderBottomColor: theme.colors.line },
            ]}
          >
            <View style={local.modalTitleWrap}>
              <Text style={local.modalEyebrow}>
                {detail?.type === "order"
                  ? "Order details"
                  : "Ticket details"}
              </Text>
              <Text
                style={[local.modalTitle, { color: theme.colors.ink }]}
                numberOfLines={2}
              >
                {detail?.title}
              </Text>
            </View>

            <View style={local.modalActions}>
              {detail?.type === "order" && detail.pdfId ? (
                <Pressable
                  onPress={() => onDownloadPdf(detail.pdfId)}
                  disabled={downloadingPdf}
                  style={({ pressed }) => [
                    local.pdfButton,
                    pressed && local.pressed,
                    downloadingPdf && local.buttonDisabled,
                  ]}
                >
                  <Text style={local.pdfText}>
                    {downloadingPdf ? "Downloading" : "PDF"}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  local.closeButton,
                  {
                    backgroundColor: theme.colors.panelSoft,
                    borderColor: theme.colors.line,
                  },
                  pressed && local.pressed,
                ]}
              >
                <Text
                  style={[local.closeText, { color: theme.colors.ink }]}
                >
                  Close
                </Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={local.detailContent}
            showsVerticalScrollIndicator={false}
          >
            {detail?.type === "ticket" &&
            typeof item?.qr_image === "string" ? (
              <QrImage value={item.qr_image} />
            ) : null}

            {detail?.type === "ticket" && ticketOrderReference ? (
              <DetailField
                fieldKey="order_code"
                label="Order"
                value={ticketOrderReference}
              />
            ) : null}

            {detail?.type === "ticket" && ticketMatchName ? (
              <DetailField
                fieldKey="match"
                label="Match"
                value={ticketMatchName}
              />
            ) : null}

            {entries.map(([key, value]) => (
              <DetailField
                key={key}
                fieldKey={key}
                label={labelize(key)}
                value={value}
              />
            ))}

            {items.length ? (
              <View style={local.detailGroup}>
                <Text
                  style={[
                    local.detailGroupTitle,
                    { color: theme.colors.ink },
                  ]}
                >
                  Items
                </Text>
                {items.map((entry, index) => (
                  <NestedCard key={index} item={entry} />
                ))}
              </View>
            ) : null}

            {tickets.length ? (
              <View style={local.detailGroup}>
                <Text
                  style={[
                    local.detailGroupTitle,
                    { color: theme.colors.ink },
                  ]}
                >
                  Tickets
                </Text>
                {tickets.map((entry, index) => (
                  <NestedCard key={index} item={entry} />
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailField({
  fieldKey,
  label,
  value,
}: {
  fieldKey: string;
  label: string;
  value: unknown;
}) {
  const local = useProfileDetailStyles();
  const theme = useTheme();

  if (Array.isArray(value)) return null;

  if (label.toLowerCase() === "qr image" && typeof value === "string") {
    return <QrImage value={value} />;
  }

  if (isRecord(value)) {
    return (
      <View style={local.detailGroup}>
        <Text
          style={[
            local.detailGroupTitle,
            { color: theme.colors.ink },
          ]}
        >
          {label}
        </Text>
        <NestedCard item={value} />
      </View>
    );
  }

  return (
    <View
      style={[
        local.detailField,
        {
          backgroundColor: theme.colors.panelSoft,
          borderColor: theme.colors.line,
        },
      ]}
    >
      <Text style={[local.detailLabel, { color: theme.colors.muted }]}>
        {label}
      </Text>
      <Text style={[local.detailValue, { color: theme.colors.ink }]}>
        {formatDetailValue(value, fieldKey)}
      </Text>
    </View>
  );
}

function NestedCard({ item }: { item: ProfileDetailItem }) {
  const local = useProfileDetailStyles();
  const theme = useTheme();
  const hasQr = typeof item.qr_image === "string";

  return (
    <View
      style={[
        local.nestedCard,
        {
          backgroundColor: theme.colors.panelSoft,
          borderColor: theme.colors.line,
        },
      ]}
    >
      {hasQr ? <QrImage value={item.qr_image} compact /> : null}

      {Object.entries(item)
        .filter(([key, value]) => shouldShowDetailField(key, value))
        .slice(0, 8)
        .map(([key, value]) => (
          <View key={key} style={local.nestedRow}>
            <Text
              style={[
                local.nestedLabel,
                { color: theme.colors.muted },
              ]}
            >
              {labelize(key)}
            </Text>
            <Text
              style={[
                local.nestedValue,
                { color: theme.colors.ink },
              ]}
            >
              {isRecord(value) || Array.isArray(value)
                ? summarizeValue(value)
                : formatDetailValue(value, key)}
            </Text>
          </View>
        ))}
    </View>
  );
}

function QrImage({
  value,
  compact = false,
}: {
  value: string;
  compact?: boolean;
}) {
  const local = useProfileDetailStyles();

  if (!value.startsWith("data:image/")) {
    return (
      <View style={local.qrEmpty}>
        <Text style={local.qrEmptyText}>QR unavailable</Text>
      </View>
    );
  }

  return (
    <View style={[local.qrWrap, compact && local.qrWrapCompact]}>
      <Image
        source={{ uri: value }}
        style={[local.qrImage, compact && local.qrImageCompact]}
        resizeMode="contain"
      />
      {!compact ? (
        <Text style={local.qrCaption}>Ticket QR code</Text>
      ) : null}
    </View>
  );
}

function isRecord(value: unknown): value is ProfileDetailItem {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayValue(
  item: ProfileDetailItem,
  keys: string[],
  fallback = "-",
) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }

  return fallback;
}

function labelize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDetailValue(value: unknown, key = "") {
  if (value === null || value === undefined || value === "") return "-";
  if (key === "payment_method") {
    return paymentMethodLabel(String(value));
  }
  if (isDateKey(key)) return formatDateValue(String(value));
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function paymentMethodLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "cybersource") return "Credit / Debit Card";
  if (normalized === "blue") return "Blue Wallet";
  return value;
}

function isDateKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized.endsWith("_at") ||
    normalized.includes("date") ||
    normalized.includes("time")
  );
}

function shouldShowDetailField(key: string, value: unknown) {
  return (
    ![
      "qr_image",
      "created_at",
      "id",
      "order_number",
      "order_code",
      "ticket_code",
      "code",
    ].includes(key) &&
    value !== null &&
    value !== undefined &&
    value !== ""
  );
}

function formatDateValue(value: string) {
  if (!value) return "Date unavailable";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function summarizeValue(value: unknown) {
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }

  if (!isRecord(value)) return formatDetailValue(value);

  return displayValue(
    value,
    [
      "name",
      "label",
      "title",
      "code",
      "ticket_code",
      "order_code",
      "home_team",
    ],
    "Details",
  );
}

function useProfileDetailStyles() {
  const theme = useTheme();

  return useMemo(
    () => createProfileDetailStyles(theme.colors),
    [theme.colors],
  );
}

function createProfileDetailStyles(colors: ThemeColors) {
  return StyleSheet.create({
    modalOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(21,26,44,0.48)",
    },
    modalSheet: {
      maxHeight: "88%",
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: colors.panel,
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 8,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
      paddingBottom: 14,
    },
    modalTitleWrap: {
      flex: 1,
      minWidth: 0,
    },
    modalEyebrow: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    modalTitle: {
      color: colors.ink,
      fontSize: 21,
      fontWeight: "900",
      lineHeight: 27,
    },
    modalActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    pdfButton: {
      minHeight: 38,
      borderRadius: 13,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 13,
    },
    pdfText: {
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: "900",
    },
    buttonDisabled: {
      opacity: 0.58,
    },
    closeButton: {
      minHeight: 38,
      borderRadius: 13,
      backgroundColor: colors.panelSoft,
      borderWidth: 1,
      borderColor: colors.line,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    closeText: {
      color: colors.ink,
      fontSize: 13,
      fontWeight: "900",
    },
    detailContent: {
      gap: 10,
      paddingVertical: 14,
      paddingBottom: 28,
    },
    detailField: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelSoft,
      padding: 12,
      gap: 5,
    },
    detailLabel: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    detailValue: {
      color: colors.ink,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "700",
    },
    qrWrap: {
      alignItems: "center",
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelSoft,
      padding: 14,
      gap: 8,
    },
    qrWrapCompact: {
      alignSelf: "center",
      padding: 10,
      marginBottom: 4,
    },
    qrImage: {
      width: 190,
      height: 190,
      borderRadius: 12,
      backgroundColor: "#FFFFFF",
    },
    qrImageCompact: {
      width: 136,
      height: 136,
    },
    qrCaption: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    qrEmpty: {
      minHeight: 120,
      borderRadius: 18,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.line,
      backgroundColor: colors.panelSoft,
      alignItems: "center",
      justifyContent: "center",
      padding: 14,
    },
    qrEmptyText: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: "800",
    },
    detailGroup: {
      gap: 9,
    },
    detailGroupTitle: {
      color: colors.ink,
      fontSize: 15,
      fontWeight: "900",
    },
    nestedCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: "rgba(255,255,255,0.95)",
      padding: 12,
      gap: 8,
    },
    nestedRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
    },
    nestedLabel: {
      flex: 0.42,
      color: colors.muted,
      fontSize: 11,
      fontWeight: "900",
      textTransform: "uppercase",
    },
    nestedValue: {
      flex: 0.58,
      color: colors.ink,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      textAlign: "right",
    },
    pressed: {
      opacity: 0.72,
    },
  });
}