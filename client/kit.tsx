import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable } from "react-native";

export function IconButton({
  icon,
  label,
  color,
  onPress,
  disabled,
  size = 36,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      style={({ pressed }) => ({ minWidth: size, minHeight: size, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.5 : pressed ? 0.65 : 1 })}
    >
      <Icon name={icon} size={16} color={color} />
    </Pressable>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
