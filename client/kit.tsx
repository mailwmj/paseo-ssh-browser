import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable } from "react-native";

export function IconButton({
  icon,
  label,
  color,
  onPress,
  disabled,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      style={{ minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <Icon name={icon} size={16} color={color} />
    </Pressable>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
