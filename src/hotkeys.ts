import { type App, type Hotkey, type KeymapContext, type Modifier, Platform, type Plugin } from "obsidian";

export const OPEN_POPUP_COMMAND = "completr-open-suggestion-popup";
export const BLACKLIST_COMMAND = "completr-blacklist-current-word";

function compileModifiers(modifiers: Modifier[]): string {
    return modifiers
        .map((m) => (m === "Mod" ? (Platform.isMacOS ? "Meta" : "Ctrl") : m))
        .sort()
        .join(",");
}

/** Same matching rules as Obsidian's hotkey manager. */
export function isHotkeyMatch(hotkey: Hotkey, ctx: KeymapContext): boolean {
    if (compileModifiers(hotkey.modifiers) !== ctx.modifiers) return false;
    return hotkey.key === ctx.vkey || (!!ctx.key && hotkey.key.toLowerCase() === ctx.key.toLowerCase());
}

/** The hotkeys of a command (by its full id): the user's, or the defaults if they weren't changed. */
export function getHotkeys(app: App, commandId: string): Hotkey[] {
    const { hotkeyManager } = app;
    return hotkeyManager.getHotkeys(commandId) ?? hotkeyManager.getDefaultHotkeys(commandId) ?? [];
}

/** The first hotkey of one of this plugin's commands as text, e.g. "Ctrl+Shift+D". Null if it has none. */
export function getHotkeyLabel(plugin: Plugin, commandId: string): string | null {
    const hotkey = getHotkeys(plugin.app, `${plugin.manifest.id}:${commandId}`)[0];
    if (!hotkey) return null;
    const names: Record<string, string> = {
        Mod: Platform.isMacOS ? "Cmd" : "Ctrl",
        Meta: Platform.isMacOS ? "Cmd" : "Win",
    };
    const key = hotkey.key === " " ? "Space" : hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
    return [...hotkey.modifiers.map((m) => names[m] ?? m), key].join("+");
}
