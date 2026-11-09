/**
 * Helpers for the popup/keybinding e2e tests: a dedicated word list, and access to a few Obsidian internals (hotkeys,
 * vim mode, clipboard events) that the shared harness doesn't cover.
 */
import { expect } from "bun:test";
import type { Obsidian, PopupState } from "../harness/obsidian.ts";

const PLUGIN_DIR = ".obsidian/plugins/obsidian-completr";
export const WORD_LIST_PATH = `${PLUGIN_DIR}/wordLists/popup_keys.txt`;
export const BLACKLIST_PATH = `${PLUGIN_DIR}/blacklisted_suggestions.txt`;
/** Shortest first, which is the default sort order. */
export const XYL_WORDS = ["xylem", "xylitol", "xylophone"];
export const DAN_WORDS = ["dandruff", "dandelion"];
/** The note all tests of this suite use, so other suites' notes aren't touched. */
export const NOTE_PATH = "popup-keys.md";

export const COMMANDS = {
    open: "obsidian-completr:completr-open-suggestion-popup",
    insert: "obsidian-completr:completr-insert-selected-suggestion",
    toggleAutoTrigger: "obsidian-completr:completr-toggle-auto-trigger",
};

/** Installs the word list of this suite and (re)loads the word list provider. */
export async function installWordList(obsidian: Obsidian) {
    await obsidian.writeVaultFile(WORD_LIST_PATH, [...XYL_WORDS, ...DAN_WORDS].join("\n"));
    await reloadWordLists(obsidian);
}

export async function removeWordList(obsidian: Obsidian) {
    await obsidian.eval(async (path: string) => {
        if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
    }, WORD_LIST_PATH);
    await reloadWordLists(obsidian);
}

export async function reloadWordLists(obsidian: Obsidian) {
    await obsidian.eval(async () => {
        const plugin = app.plugins.plugins["obsidian-completr"]!;
        await plugin.loaded;
        await plugin.wordList.load(plugin.settings);
    });
}

export async function unblacklist(obsidian: Obsidian, words: string[]) {
    await obsidian.eval(async (words: string[]) => {
        const plugin = app.plugins.plugins["obsidian-completr"]!;
        for (const w of words) await plugin.blacklist.remove(w);
    }, words);
    await reloadWordLists(obsidian);
}

/** Opens the suite's note. `<|>` marks the cursor. */
export function openNote(obsidian: Obsidian, content: string, opts: { sourceMode?: boolean } = {}) {
    return obsidian.openNote(content, { path: NOTE_PATH, ...opts });
}

/** Waits until the popup shows exactly `items`. */
export function waitForItems(obsidian: Obsidian, items: string[]): Promise<PopupState> {
    return obsidian.waitForPopup((p) => JSON.stringify(p.items) === JSON.stringify(items));
}

export async function waitForSelected(obsidian: Obsidian, index: number): Promise<PopupState> {
    return obsidian.waitForPopup((p) => p.selected === index);
}

/** Waits for the popup to close (it closes asynchronously after some changes). */
export async function waitForClosed(obsidian: Obsidian) {
    let last: PopupState | undefined;
    try {
        await obsidian.waitFor(
            async () => {
                last = await obsidian.popup();
                return !last.visible;
            },
            { timeout: 1000, what: "popup to close" },
        );
    } catch {
        throw new Error("Popup did not close. Last state: " + JSON.stringify(last));
    }
}

/** Polls the editor until its text equals `text`, then asserts it (gives a readable diff on failure). */
export async function expectText(obsidian: Obsidian, textWithCursor: string) {
    let last = "";
    try {
        await obsidian.waitFor(
            async () => {
                last = (await obsidian.editor()).textWithCursor;
                return last === textWithCursor;
            },
            { timeout: 500, what: "editor text" },
        );
    } catch {
        /* reported below */
    }
    expect(last).toBe(textWithCursor);
}

/** Internal popup state: open, focused (an item is selected so Enter inserts), and the "unfocused" CSS class. */
export function popupInternals(obsidian: Obsidian) {
    return obsidian.eval(() => {
        const popup = app.plugins.plugins["obsidian-completr"]!.popup;
        return {
            isOpen: popup.isOpen,
            focused: popup.isFocused(),
            unfocusedClass: popup.suggestEl.hasClass("completr-unfocused"),
            highlighted: popup.suggestEl.querySelectorAll(".suggestion-item.is-selected").length,
        };
    });
}

/** Simulates a real paste (Ctrl+V) without touching the system clipboard, which other processes might use. */
export async function paste(obsidian: Obsidian, text: string) {
    await obsidian.eval((text: string) => {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
        app.workspace.activeEditor!.editor!.cm.contentDOM.dispatchEvent(event);
    }, text);
}

interface HotkeyManager {
    setHotkeys(id: string, hotkeys: { modifiers: string[]; key: string }[]): void;
    removeHotkeys(id: string): void;
}

export function hasHotkeyManager(obsidian: Obsidian) {
    return obsidian.eval(() => {
        const hm = (app as unknown as { hotkeyManager?: Partial<HotkeyManager> }).hotkeyManager;
        return typeof hm?.setHotkeys === "function" && typeof hm.removeHotkeys === "function";
    });
}

export function setHotkeys(obsidian: Obsidian, id: string, hotkeys: { modifiers: string[]; key: string }[]) {
    return obsidian.eval(
        (id: string, hotkeys: { modifiers: string[]; key: string }[]) => {
            (app as unknown as { hotkeyManager: HotkeyManager }).hotkeyManager.setHotkeys(id, hotkeys);
        },
        id,
        hotkeys,
    );
}

/** Restores the default hotkeys of a command. */
export function resetHotkeys(obsidian: Obsidian, id: string) {
    return obsidian.eval((id: string) => {
        (app as unknown as { hotkeyManager: HotkeyManager }).hotkeyManager.removeHotkeys(id);
    }, id);
}

export function setVimMode(obsidian: Obsidian, enabled: boolean) {
    return obsidian.eval((enabled: boolean) => {
        (app.vault as unknown as { setConfig(key: string, value: unknown): void }).setConfig("vimMode", enabled);
    }, enabled);
}

/** Whether the active editor's vim is in insert mode, null if vim isn't active. */
export function vimInsertMode(obsidian: Obsidian) {
    return obsidian.eval(() => {
        const view = app.workspace.activeEditor!.editor!.cm as unknown as {
            cm?: { state?: { vim?: { insertMode?: boolean } } };
        };
        const vim = view.cm?.state?.vim;
        return vim ? !!vim.insertMode : null;
    });
}
