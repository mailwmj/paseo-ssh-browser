import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable } from "react-native";

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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
