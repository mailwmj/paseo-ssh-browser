import type { PluginTheme } from "@getpaseo/plugin";
import { useTranslation } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { messages } from "./messages";
import { errorMessage } from "./kit";

const command = "paseo plugin add git:https://github.com/mailwmj/paseo-ssh-browser.git";

export function InstallHint({ theme, side }: { theme: PluginTheme; side: "local" | "remote" }) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  return (
    <View style={{ gap: 8, alignItems: "flex-start" }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 }}>
        {t(side === "local" ? "installLocalHint" : "installRemoteHint")}
      </Text>
      <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18 }}>{command}</Text>
      <Pressable accessibilityRole="button" onPress={() => void copyText(command)
        .then(() => toast.show(t("installCommandCopied"), { variant: "success" }))
        .catch((error) => toast.error(errorMessage(error)))}>
        <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{t("copyInstallCommand")}</Text>
      </Pressable>
    </View>
  );
}
