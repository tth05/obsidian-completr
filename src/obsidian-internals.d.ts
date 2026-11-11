/**
 * Typings for the (few) non-public Obsidian internals this plugin relies on. Keeping them in one place makes it easy to
 * see what could break with an Obsidian update.
 */
import type { EditorView } from "@codemirror/view";
import "obsidian";

declare module "obsidian" {
    interface App {
        /** Opens a vault relative path with the system's default application. */
        openWithDefaultApp(path: string): void;
        hotkeyManager: {
            /** The user's hotkeys for a command, undefined if they weren't customized. */
            getHotkeys(commandId: string): Hotkey[] | undefined;
            getDefaultHotkeys(commandId: string): Hotkey[] | undefined;
        };
        setting: {
            open(): void;
            /** Opens a settings tab and returns it. The hotkeys tab can be filtered with `setQuery`. */
            openTabById(id: string): { setQuery?(query: string): void } | null;
        };
        commands: {
            /** Note: Always returns true if the command exists, even if its checkCallback returned false. */
            executeCommand(command: Command, evt?: Event): boolean;
        };
    }

    interface Scope {
        keys: KeymapEventHandler[];
    }

    interface Vault {
        getConfig(key: string): unknown;
    }

    interface Workspace {
        editorSuggest?: {
            /** The editor suggest that triggered last, e.g. Obsidian's link suggestions. */
            currentSuggest: EditorSuggest<unknown> | null;
        };
    }

    interface Editor {
        cm: EditorView;
    }

    interface Command {
        /** Set by Obsidian for editor commands: wraps editorCallback/editorCheckCallback. */
        checkCallback?: (checking: boolean) => boolean | void;
    }

    interface PopoverSuggest<T> {
        isOpen: boolean;
        suggestEl: HTMLElement;
        suggestions: {
            selectedItem: number;
            values: T[];
            setSelectedItem(index: number, evt: Event | null): void;
            useSelectedItem(evt?: Event): boolean;
        };
    }

    interface EditorSuggest<T> {
        /**
         * Asks this suggest to update for the given editor. `allowOpen` is true when the update was caused by user input,
         * otherwise the popup is only updated if it is already open.
         */
        trigger(editor: Editor, file: TFile | null, allowOpen: boolean): boolean | undefined;
    }
}
