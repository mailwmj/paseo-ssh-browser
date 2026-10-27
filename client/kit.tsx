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

export function Avatar({ text, theme }: { text: string; theme: PluginTheme }) {
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.surface2,
      }}
    >
      <Text style={{ color: theme.colors.accent, fontSize: 14, fontWeight: "700" }}>
        {(text.trim()[0] ?? "?").toUpperCase()}
      </Text>
    </View>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
