import { translate } from "../i18n/runtime.ts";
import { profileService } from "@/services/auth";
import { Platform } from "react-native";

export async function downloadProfileOrderPdf(
  orderId: string,
  isCurrent: () => boolean = () => true,
) {
  const pdfBytes = await profileService.orderPdf(orderId);
  if (!isCurrent()) return false;

  if (Platform.OS !== "web") {
    const FileSystem = await import("expo-file-system");
    const Sharing = await import("expo-sharing");
    // Expo's native File methods are inherited even when the web-first generated
    // typings selected by this project omit them.
    const file = new FileSystem.File(
      FileSystem.Paths.cache,
      `order-${orderId}.pdf`,
    ) as unknown as {
      create: (options?: { overwrite?: boolean }) => void;
      write: (content: Uint8Array) => void;
      exists: boolean;
      size: number;
      uri: string;
    };
    file.create({ overwrite: true });
    file.write(pdfBytes);
    if (!file.exists || file.size !== pdfBytes.byteLength || file.size === 0) {
      throw new Error(translate("pdf.writeFailed"));
    }
    if (!isCurrent()) return false;
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error(translate("pdf.noApp"));
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/pdf",
      dialogTitle: `Order ${orderId}`,
    });
    return true;
  }

  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  if (!isCurrent()) return false;
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `order-${orderId}.pdf`;
  anchor.click();
  window.URL.revokeObjectURL(url);
  return true;
}
