import type { PluginTheme } from "@getpaseo/plugin";
import { useTranslation } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { messages } from "./messages";
import { errorMessage } from "./kit";

const command = "paseo plugin add git:https://github.com/mailwmj/paseo-ssh-browser.git";

export function InstallHint({ theme, side, unavailable = false }: { theme: PluginTheme; side: "local" | "remote"; unavailable?: boolean }) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  const colors = theme.colors;
  const title = side === "local" ? "installLocalTitle" : unavailable ? "installRemoteUnavailableTitle" : "installRemoteTitle";
  const hint = side === "local" ? "installLocalHint" : unavailable ? "installRemoteUnavailableHint" : "installRemoteHint";
  return (
    <View style={{ backgroundColor: colors.surface1, borderRadius: 8, padding: 16, gap: 12, alignSelf: "stretch" }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <Icon name="Info" size={17} color={colors.foregroundMuted} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{t(title)}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 }}>{t(hint)}</Text>
        </View>
      </View>
      <View style={{ backgroundColor: colors.surface0, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Text selectable style={{ color: colors.foreground, fontSize: 12, lineHeight: 19, fontFamily: "monospace", flexGrow: 1, flexShrink: 1 }}>{command}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("copyInstallCommand")}
          onPress={() => void copyText(command).then(() => toast.show(t("installCommandCopied"), { variant: "success" }))
            .catch((error) => toast.error(errorMessage(error)))}
          style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 10, borderRadius: 6, backgroundColor: pressed ? colors.surface2 : colors.surface1, flexDirection: "row", alignItems: "center", gap: 6 })}>
          <Icon name="Copy" size={14} color={colors.foregroundMuted} />
          <Text style={{ color: colors.foreground, fontSize: 12 }}>{t("copyInstallCommand")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
