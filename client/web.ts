import { Platform } from "react-native";
import { parseHostRegistry, type HostRegistry } from "./format";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const localStorage: { getItem(key: string): string | null };

// Paseo Desktop keeps its saved hosts in the app's web storage. This is not a plugin API, so when
// it changes or is missing, nothing is found and the screen asks for an SSH host instead.
export function readHostRegistry(): HostRegistry {
  if (Platform.OS !== "web") return { ssh: [], local: [] };
  try {
    return parseHostRegistry(localStorage.getItem("@paseo:daemon-registry"));
  } catch {
    return { ssh: [], local: [] };
  }
}
