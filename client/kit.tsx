import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";

export function IconButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={{ padding: 6 }}
    >
      <Icon name={icon} size={16} color={color} />
    </Pressable>
  );
}

// Mid-tone fills that read with either theme's background color as the letter.
const AVATAR_COLORS = ["#e0607e", "#3fbfa0", "#5b8def", "#e8a23b", "#9b6cf0", "#4fb3d9", "#d9734f"];

export function Avatar({ text, theme }: { text: string; theme: PluginTheme }) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length],
      }}
    >
      <Text style={{ color: theme.colors.surface0, fontSize: 14, fontWeight: "700" }}>
        {(text.trim()[0] ?? "?").toUpperCase()}
      </Text>
    </View>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
