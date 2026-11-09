/**
 * Helpers for the LaTeX / snippet e2e tests.
 */
import { expect } from "bun:test";
import type { Obsidian, PopupState } from "../harness/obsidian.ts";

let noteCounter = 0;

/**
 * Opens the content in a new note. Snippet placeholders survive replacing the whole text of a note (see the stale
 * placeholder test in snippets.test.ts), switching to another file clears them, so every test uses its own note.
 */
export function openFreshNote(obsidian: Obsidian, content: string, opts: { sourceMode?: boolean } = {}) {
    return obsidian.openNote(content, { ...opts, path: `latex-e2e-${process.pid}-${++noteCounter}.md` });
}

/** Waits for the popup to show LaTeX suggestions (the `\frac` command for queries like `\fr`). */
export function waitForLatexPopup(obsidian: Obsidian, expected = "\\frac{#}{#}"): Promise<PopupState> {
    return obsidian.waitForPopup((p) => p.items.includes(expected));
}

/** Opens a note with the given content, types `typed` and expects LaTeX suggestions. */
export async function expectLatexSuggestions(obsidian: Obsidian, content: string, typed = "\\fr") {
    await openFreshNote(obsidian, content);
    await obsidian.type(typed);
    const popup = await waitForLatexPopup(obsidian);
    expect(popup.items[0]).toBe("\\frac{#}{#}");
}

/**
 * Opens a note with the given content, types `typed` and expects no LaTeX suggestions. The popup may still be open
 * with words from other providers, so only LaTeX commands are checked.
 */
export async function expectNoLatexSuggestions(obsidian: Obsidian, content: string, typed = "\\fr") {
    await openFreshNote(obsidian, content);
    await obsidian.type(typed);
    const deadline = Date.now() + 250;
    while (Date.now() < deadline) {
        const popup = await obsidian.popup();
        expect(popup.items.filter((i) => i.startsWith("\\"))).toEqual([]);
        await Bun.sleep(25);
    }
}

export interface PlaceholderInfo {
    /** Number of rendered placeholder elements (empty widgets and marks). */
    count: number;
    /** Number of empty placeholder widgets. */
    empty: number;
}

export function placeholders(obsidian: Obsidian): Promise<PlaceholderInfo> {
    return obsidian.eval(() => {
        const root = app.workspace.activeEditor?.editor?.cm.dom;
        if (!root) return { count: 0, empty: 0 };
        return {
            count: root.querySelectorAll(".completr-placeholder").length,
            empty: root.querySelectorAll(".completr-placeholder-empty").length,
        };
    });
}

/** Clicks into the active editor at the given document offset with real mouse events. */
export async function clickAt(obsidian: Obsidian, offset: number) {
    const { x, y } = await obsidian.eval((offset: number) => {
        const cm = app.workspace.activeEditor!.editor!.cm;
        const coords = cm.coordsAtPos(offset);
        if (!coords) throw new Error("Position not visible: " + offset);
        return { x: coords.left + 1, y: (coords.top + coords.bottom) / 2 };
    }, offset);
    const base = { x, y, button: "left", clickCount: 1 };
    await obsidian.cdp.send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved", button: "none" });
    await obsidian.cdp.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
    await obsidian.cdp.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
}

/**
 * Records the document text after every update of the active editor (including intermediate ones the tests can't
 * observe by polling). Call the returned function to stop recording and get the recorded texts.
 */
export async function recordDocuments(obsidian: Obsidian): Promise<() => Promise<string[]>> {
    await obsidian.eval(() => {
        const cm = app.workspace.activeEditor!.editor!.cm as import("@codemirror/view").EditorView & {
            __recorded?: string[];
        };
        const recorded: string[] = [];
        const original = cm.update.bind(cm);
        cm.__recorded = recorded;
        cm.update = (transactions) => {
            original(transactions);
            recorded.push(cm.state.doc.toString());
        };
    });
    return () =>
        obsidian.eval(() => {
            const cm = app.workspace.activeEditor!.editor!.cm as import("@codemirror/view").EditorView & {
                __recorded?: string[];
            };
            const recorded = cm.__recorded ?? [];
            // Removes the own property, restoring the prototype method.
            delete (cm as Partial<typeof cm>).update;
            delete cm.__recorded;
            return recorded;
        });
}

/** Selects the popup item with the given text (ArrowDown/ArrowUp) and inserts it with Enter. */
export async function selectAndInsert(obsidian: Obsidian, item: string) {
    const popup = await obsidian.waitForPopup((p) => p.items.includes(item));
    const target = popup.items.indexOf(item);
    let selected = popup.selected < 0 ? 0 : popup.selected;
    while (selected !== target) {
        await obsidian.press(selected < target ? "ArrowDown" : "ArrowUp");
        selected += selected < target ? 1 : -1;
    }
    await obsidian.waitForPopup((p) => p.selected === target);
    await obsidian.press("Enter");
    await obsidian.waitFor(async () => !(await obsidian.popup()).visible, { what: "the popup to close" });
}
