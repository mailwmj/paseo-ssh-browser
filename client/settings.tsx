import { useSettings, useTranslation, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { visibilitySettings } from "../shared/visibility";
import { messages } from "./messages";

export function Settings({ theme }: PluginSurfaceProps) {
  const { t } = useTranslation(messages);
  const settings = useSettings(visibilitySettings);
  if (settings.status === "loading") return null;
  if (settings.status !== "ready") return <Text style={{ color: theme.colors.foreground }}>{settings.error}</Text>;
  return (
    <SettingsSection title={t("settingsSection")}>
      <SettingsCard>
        <SettingsSwitch label={t("showFileTransfer")} hint={t("fileTransferHint")}
          value={settings.values.fileTransfer} disabled={settings.saving} error={settings.saveError}
          onValueChange={(fileTransfer) => void settings.save({ ...settings.values, fileTransfer }, settings.revision)} />
      </SettingsCard>
    </SettingsSection>
  );
}
