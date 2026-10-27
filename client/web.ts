import { Platform } from "react-native";
import { sshHostsFromRegistry, type AppSshHost } from "./format";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const localStorage: { getItem(key: string): string | null };

// Paseo Desktop keeps its saved hosts in the app's web storage. This is not a plugin API, so when
// it changes or is missing the screen falls back to SSH hosts entered by hand.
export function readAppSshHosts(): AppSshHost[] {
  if (Platform.OS !== "web") return [];
  try {
    return sshHostsFromRegistry(localStorage.getItem("@paseo:daemon-registry"));
  } catch {
    return [];
  }
}
