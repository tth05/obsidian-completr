import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { around } from "monkey-around";
import { type Command, type Editor, type Hotkey, type KeymapContext, type Modifier, Notice, Platform } from "obsidian";
import type CompletrPlugin from "./main.ts";
import { SelectionDirection } from "./popup.ts";
import { isInPlaceholder, jumpToNextPlaceholder } from "./snippets.ts";

/*
 * How keys reach Completr:
 *
 * All navigation keys are regular Obsidian commands, so users can rebind them in the hotkey settings. Two Obsidian
 * behaviours get in the way of that, and are worked around here:
 *
 * 1. Obsidian's hotkey manager consumes a key as soon as a command with a matching hotkey exists, even if the command's
 *    check callback says it isn't applicable. Without a fix, binding Enter to "insert suggestion" would break Enter
 *    everywhere. -> `executeCommand` is wrapped to respect the check callback of Completr's commands, so the key
 *    falls through to other hotkeys and finally the editor.
 *
 * 2. While any editor suggest is open, Obsidian's editor swallows ArrowUp/ArrowDown/Enter/Tab. If Completr's popup is
 *    open but none of its commands handled the key, the user wants the editor's default action (e.g. a new line).
 *    -> A high-precedence CodeMirror keymap closes the popup and lets the key continue to the next handlers.
 *
 * 3. Obsidian runs the first command whose hotkey matches, and its own commands come first. Completr's defaults
 *    Ctrl+Enter and Ctrl+Tab are also bound to core commands, so the bypass commands would never run. -> While the popup
 *    is open, its keymap scope is consulted before the global hotkeys. A handler there runs Completr's commands for
 *    their configured hotkeys first.
 */

interface CompletrCommand extends Command {
    id: string;
    /** Applicable check, and the action itself. */
    editorCheckCallback: (checking: boolean, editor: Editor) => boolean;
}

function editorCommand(
    id: string,
    name: string,
    hotkeys: Hotkey[],
    isApplicable: (editor: Editor) => boolean,
    run: (editor: Editor) => void,
    repeatable = false,
): CompletrCommand {
    return {
        id,
        name,
        hotkeys,
        repeatable,
        editorCheckCallback: (checking, editor) => {
            if (!isApplicable(editor)) return false;
            if (!checking) run(editor);
            return true;
        },
    };
}

function compileModifiers(modifiers: Modifier[]): string {
    return modifiers
        .map((m) => (m === "Mod" ? (Platform.isMacOS ? "Meta" : "Ctrl") : m))
        .sort()
        .join(",");
}

/** Same matching rules as Obsidian's hotkey manager. */
function isHotkeyMatch(hotkey: Hotkey, ctx: KeymapContext): boolean {
    if (compileModifiers(hotkey.modifiers) !== ctx.modifiers) return false;
    return hotkey.key === ctx.vkey || (!!ctx.key && hotkey.key.toLowerCase() === ctx.key.toLowerCase());
}

/** Closes the popup and sends a key to the editor, without the modifiers that triggered the bypass command. */
function bypassPopup(plugin: CompletrPlugin, editor: Editor, key: "Enter" | "Tab") {
    plugin.popup.close();
    editor.cm.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
    );
}

export function registerCommands(plugin: CompletrPlugin) {
    const { popup } = plugin;
    const isOpen = () => popup.isOpen;
    const isFocused = () => popup.isFocused();
    const isVimMode = () => !!plugin.app.vault.getConfig("vimMode");

    const commands: CompletrCommand[] = [
        editorCommand(
            "completr-open-suggestion-popup",
            "Open suggestion popup",
            [{ modifiers: ["Mod"], key: " " }],
            () => true,
            (editor) => popup.triggerManually(editor, plugin.app.workspace.getActiveFile()),
        ),
        editorCommand(
            "completr-select-next-suggestion",
            "Select next suggestion",
            [{ modifiers: [], key: "ArrowDown" }],
            isOpen,
            () => popup.selectNextItem(SelectionDirection.NEXT),
            true,
        ),
        editorCommand(
            "completr-select-previous-suggestion",
            "Select previous suggestion",
            [{ modifiers: [], key: "ArrowUp" }],
            isOpen,
            () => popup.selectNextItem(SelectionDirection.PREVIOUS),
            true,
        ),
        editorCommand(
            "completr-insert-selected-suggestion",
            "Insert selected suggestion",
            [{ modifiers: [], key: "Enter" }],
            isFocused,
            () => popup.applySelectedItem(),
        ),
        editorCommand(
            "completr-bypass-enter-key",
            "Bypass the popup and press Enter",
            [{ modifiers: ["Ctrl"], key: "Enter" }],
            isOpen,
            (editor) => bypassPopup(plugin, editor, "Enter"),
        ),
        editorCommand(
            "completr-bypass-tab-key",
            "Bypass the popup and press Tab",
            [{ modifiers: ["Ctrl"], key: "Tab" }],
            isOpen,
            (editor) => bypassPopup(plugin, editor, "Tab"),
        ),
        editorCommand(
            "completr-blacklist-current-word",
            "Add the selected suggestion to the blacklist",
            [{ modifiers: ["Mod", "Shift"], key: "D" }],
            isFocused,
            () => {
                const item = popup.getSelectedItem();
                if (item) void plugin.blacklistSuggestion(item.displayName);
            },
        ),
        // In vim mode, Escape should also leave insert mode. The keymap below closes the popup and passes the key on.
        editorCommand(
            "completr-close-suggestion-popup",
            "Close suggestion popup",
            [{ modifiers: [], key: "Escape" }],
            () => isOpen() && !isVimMode(),
            () => popup.close(),
        ),
        editorCommand(
            "completr-jump-to-next-snippet-placeholder",
            "Jump to next snippet placeholder",
            [{ modifiers: [], key: "Enter" }],
            (editor) => !isFocused() && isInPlaceholder(editor.cm.state),
            (editor) => jumpToNextPlaceholder(editor.cm),
        ),
    ];

    for (const command of commands) plugin.addCommand(command);

    plugin.addCommand({
        id: "completr-toggle-auto-trigger",
        name: "Toggle automatic popup",
        callback: async () => {
            plugin.settings.autoTrigger = !plugin.settings.autoTrigger;
            await plugin.saveSettings();
            new Notice(`Completr: Automatic popup ${plugin.settings.autoTrigger ? "enabled" : "disabled"}`);
        },
    });

    // See (3) above
    popup.scope.register(null, null, (evt, ctx) => {
        const editor = plugin.app.workspace.activeEditor?.editor;
        if (!editor) return;
        const { hotkeyManager } = plugin.app;
        for (const command of commands) {
            if (evt.repeat && !command.repeatable) continue;
            const hotkeys = hotkeyManager.getHotkeys(command.id) ?? hotkeyManager.getDefaultHotkeys(command.id) ?? [];
            if (!hotkeys.some((h) => isHotkeyMatch(h, ctx))) continue;
            // Runs the command if it is applicable, otherwise try the next one
            if (command.editorCheckCallback(false, editor)) return false;
        }
        // Not handled: continue with the global hotkeys and the editor
        return undefined;
    });

    // See (1) above. Note: addCommand already prefixed the ids with the plugin id.
    const ids = new Set(commands.map((c) => c.id));
    plugin.register(
        around(plugin.app.commands, {
            executeCommand(next) {
                return function (this: unknown, command: Command, evt?: Event) {
                    if (command && ids.has(command.id) && !command.checkCallback?.(true)) return false;
                    return next.call(this, command, evt);
                };
            },
        }),
    );
}

/** See (2) above. Also implements the optional "Tab inserts/jumps" settings, which can't be expressed as hotkeys. */
export function createKeymap(plugin: CompletrPlugin) {
    const { popup } = plugin;
    const passThrough = () => {
        if (popup.isOpen) popup.close();
        return false;
    };

    return [
        Prec.highest(
            keymap.of([
                { key: "ArrowUp", run: passThrough },
                { key: "ArrowDown", run: passThrough },
                { key: "Enter", run: passThrough },
                { key: "Escape", run: passThrough },
                { key: "Tab", run: passThrough },
            ]),
        ),
        // The optional Tab actions run as a keydown handler: plugins like LaTeX Suite handle Tab in their own keydown
        // handlers, which CodeMirror runs before any keymap.
        Prec.highest(
            EditorView.domEventHandlers({
                keydown: (evt, view) => {
                    if (evt.key !== "Tab" || evt.shiftKey || evt.ctrlKey || evt.altKey || evt.metaKey) return false;
                    const { settings } = plugin;
                    if (settings.insertWithTab && popup.isFocused()) popup.applySelectedItem();
                    else if (settings.jumpWithTab && !popup.isOpen && isInPlaceholder(view.state))
                        jumpToNextPlaceholder(view);
                    else return false;
                    evt.preventDefault();
                    return true;
                },
            }),
        ),
    ];
}
