/**
 * The buttons of a suggestion in the popup ("Never suggest this", "Edit ..."). They are hovered and clicked with real
 * mouse events, because the point of these tests is that the interaction works for a user: the buttons only appear
 * while hovering, and a click on them must neither insert the suggestion nor take the focus from the editor.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { CustomEntry } from "../../src/provider/custom_suggestions.ts";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import { selectAndInsert } from "./helpers/latex.ts";
import { clickMouse, centerOf, parkMouse } from "./helpers/mouse.ts";
import { clearNotices, clickNoticeLink, waitForNotice } from "./helpers/notices.ts";
import {
    clickSuggestionAction,
    HIDE_ACTION,
    hoverSuggestion,
    rowsWithVisibleActions,
    suggestionRows,
} from "./helpers/popup_actions.ts";
import { expectText, waitForClosed, waitForItems } from "./helpers/popup_keys.ts";
import { clickModalButton, fillEntryModal, waitForEntryModal, waitForNoModal } from "./helpers/settings_tab.ts";
import { deleteNotes, removeWordLists, renderedItems, setWordList } from "./helpers/words.ts";

const NOTE = "popup-actions.md";
const WORD_LIST = "e2e-popup-actions.txt";
/** Shortest first, which is the default sort order. */
const WORDS = ["hovword", "hovwords", "hovwordless"];
const HIDE_TOOLTIP = `${HIDE_ACTION} (${process.platform === "darwin" ? "Cmd" : "Ctrl"}+Shift+D)`;

let obsidian: Obsidian;
let originalCommands: CustomEntry[];
let originalSnippets: CustomEntry[];

function blacklist() {
    return obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.blacklist.values());
}

function setLatexCommands(commands: CustomEntry[]) {
    return obsidian.eval(
        (commands: CustomEntry[]) => app.plugins.plugins["obsidian-completr"]!.latex.customEntries.set(commands),
        commands,
    );
}

function setSnippets(snippets: CustomEntry[]) {
    return obsidian.eval(
        (snippets: CustomEntry[]) => app.plugins.plugins["obsidian-completr"]!.snippets.customEntries.set(snippets),
        snippets,
    );
}

/** Types "hov" into an empty note, which suggests all {@link WORDS}. */
async function openWordPopup() {
    await obsidian.openNote("<|>", { path: NOTE });
    await obsidian.type("hov");
    await waitForItems(obsidian, WORDS);
}

beforeAll(async () => {
    obsidian = await getObsidian();
    await setWordList(obsidian, WORD_LIST, WORDS);
    [originalCommands, originalSnippets] = await obsidian.eval(() => {
        const plugin = app.plugins.plugins["obsidian-completr"]!;
        return [plugin.latex.customEntries.entries.slice(), plugin.snippets.customEntries.entries.slice()];
    });
});
beforeEach(async () => {
    await obsidian.resetSettings();
    // Only the word list of this suite, in a stable order
    await obsidian.setSettings({ fileScannerProviderEnabled: false, rankByUsage: false });
    await clearNotices(obsidian);
    await parkMouse(obsidian);
});
afterEach(async () => {
    await obsidian.eval(async (words: string[]) => {
        const plugin = app.plugins.plugins["obsidian-completr"]!;
        for (const word of words) await plugin.blacklist.remove(word);
    }, WORDS);
});
afterAll(async () => {
    // Don't leave the mouse over the place where the popups of other test files appear
    await parkMouse(obsidian);
    await clearNotices(obsidian);
    await setLatexCommands(originalCommands);
    await setSnippets(originalSnippets);
    await removeWordLists(obsidian, WORD_LIST);
    await obsidian.openNote("", { path: "test.md" });
    await deleteNotes(obsidian, [NOTE]);
});

test("the buttons of a suggestion are hidden until it is hovered", async () => {
    await openWordPopup();
    const rows = await suggestionRows(obsidian);
    expect(rows.map((r) => r.text)).toEqual(WORDS);
    for (const row of rows) {
        expect(row.actions).toHaveLength(1);
        expect(row.actions[0].tooltip).toBe(HIDE_TOOLTIP);
        expect(row.actions[0].iconClass).toContain("lucide-eye-off");
        expect(row.actions[0].visibility).toBe("hidden");
    }

    await hoverSuggestion(obsidian, "hovwords");
    await obsidian.waitFor(async () => (await rowsWithVisibleActions(obsidian)).join() === "hovwords", {
        what: "the buttons of the hovered suggestion",
    });
    await hoverSuggestion(obsidian, "hovwordless");
    await obsidian.waitFor(async () => (await rowsWithVisibleActions(obsidian)).join() === "hovwordless", {
        what: "the buttons of the hovered suggestion",
    });
    await parkMouse(obsidian);
    await obsidian.waitFor(async () => (await rowsWithVisibleActions(obsidian)).length === 0, {
        what: "the buttons to hide",
    });
    // Hovering changed nothing else
    await waitForItems(obsidian, WORDS);
    await expectText(obsidian, "hov<|>");
});

test("clicking a suggestion inserts it, clicking its hide button doesn't", async () => {
    await openWordPopup();
    await clickSuggestionAction(obsidian, "hovwords", HIDE_ACTION);
    // The popup stays open without the suggestion, nothing was inserted
    await waitForItems(obsidian, ["hovword", "hovwordless"]);
    await expectText(obsidian, "hov<|>");
    expect(await blacklist()).toContain("hovwords");
    expect(await obsidian.readVaultFile(".obsidian/plugins/obsidian-completr/blacklisted_suggestions.txt")).toContain(
        "hovwords",
    );

    // The editor kept the focus: typing continues to filter
    await obsidian.type("wordl");
    await waitForItems(obsidian, ["hovwordless"]);
    await expectText(obsidian, "hovwordl<|>");

    // A click next to the buttons, on the suggestion itself, inserts it
    await clickMouse(
        obsidian,
        await centerOf(obsidian, () => document.querySelector(".suggestion-container .completr-suggestion-text")),
    );
    await waitForClosed(obsidian);
    await expectText(obsidian, "hovwordless<|>");
});

describe("the notice after hiding a suggestion", () => {
    async function undo(word: string) {
        const notice = await waitForNotice(obsidian, `"${word}"`);
        expect(notice).toBe(`Completr: "${word}" won't be suggested anymore. Undo`);
        await clickNoticeLink(obsidian, `"${word}"`, "Undo");
        await obsidian.waitFor(async () => !(await blacklist()).includes(word), {
            what: `${word} to be removed from the blacklist`,
        });
    }

    test("Undo brings a suggestion hidden with the button back", async () => {
        await openWordPopup();
        await clickSuggestionAction(obsidian, "hovwords", HIDE_ACTION);
        await waitForItems(obsidian, ["hovword", "hovwordless"]);
        await undo("hovwords");

        // Suggested again right away, nothing has to be reloaded
        await openWordPopup();
    });

    test("the hotkey shows the same notice", async () => {
        await openWordPopup();
        await obsidian.press("D", "Mod", "Shift");
        await waitForItems(obsidian, ["hovwords", "hovwordless"]);
        await undo("hovword");

        await openWordPopup();
    });

    // Guards against the click on the notice taking the focus from the editor (as a click on a notice normally does).
    test("clicking Undo keeps the focus in the editor", async () => {
        await openWordPopup();
        await obsidian.press("D", "Mod", "Shift");
        await waitForItems(obsidian, ["hovwords", "hovwordless"]);
        await undo("hovword");

        await obsidian.type("w");
        await expectText(obsidian, "hovw<|>");
        // With the suggestion that was brought back
        await waitForItems(obsidian, WORDS);
    });
});

describe("edit button", () => {
    const EDIT_COMMAND = "Edit LaTeX command";
    const EDIT_SNIPPET = "Edit snippet";

    test("only custom LaTeX commands have one, it edits the command of its row", async () => {
        const first = { displayName: "\\fracxa", replacement: "\\frac{a}{#}" };
        const second = { displayName: "\\fracxb", replacement: "\\frac{b}{#}" };
        await setLatexCommands([first, second]);

        await obsidian.openNote("$<|>$", { path: NOTE });
        await obsidian.type("\\frac");
        await obsidian.waitForPopup((p) => p.items.includes(second.displayName));
        const rows = await suggestionRows(obsidian);
        const tooltips = (item: string) => rows.find((r) => r.text === item)!.actions.map((a) => a.tooltip);
        expect(tooltips("\\frac{#}{#}")).toEqual([HIDE_TOOLTIP]);
        expect(tooltips("\\dfrac{#}{#}")).toEqual([HIDE_TOOLTIP]);
        for (const custom of [first, second])
            expect(tooltips(custom.displayName)).toEqual([EDIT_COMMAND, HIDE_TOOLTIP]);
        const edit = rows.find((r) => r.text === second.displayName)!.actions[0];
        expect(edit.iconClass).toContain("svg-icon");
        expect(edit.visibility).toBe("hidden");

        await clickSuggestionAction(obsidian, second.displayName, EDIT_COMMAND);
        expect(await waitForEntryModal(obsidian)).toEqual({
            title: EDIT_COMMAND,
            name: second.displayName,
            replacement: second.replacement,
        });
        // The popup made room for the dialog, the command was not inserted
        expect((await obsidian.popup()).visible).toBe(false);
        expect((await obsidian.editor()).textWithCursor).toBe("$\\frac<|>$");

        await fillEntryModal(obsidian, null, "\\frac{c}{#}");
        await clickModalButton(obsidian, "Save");
        await waitForNoModal(obsidian);
        const changed = { displayName: second.displayName, replacement: "\\frac{c}{#}" };
        expect(
            JSON.parse((await obsidian.readVaultFile(".obsidian/plugins/obsidian-completr/latex_commands.json"))!),
        ).toEqual([first, changed]);

        // Back in the editor, the changed command is suggested
        await obsidian.type("x");
        await selectAndInsert(obsidian, second.displayName);
        expect((await obsidian.editor()).textWithCursor).toBe("$\\frac{c}{<|>}$");
    });

    test("snippets have one, words don't", async () => {
        const other = { displayName: "hovother", replacement: "other snippet" };
        const snippet = { displayName: "hovsnip", replacement: "first {{}} line\nsecond line" };
        await setSnippets([other, snippet]);

        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("hov");
        await waitForItems(obsidian, [snippet.displayName, other.displayName, ...WORDS]);
        const rows = await suggestionRows(obsidian);
        expect(rows.map((r) => r.actions.map((a) => a.tooltip))).toEqual([
            [EDIT_SNIPPET, HIDE_TOOLTIP],
            [EDIT_SNIPPET, HIDE_TOOLTIP],
            ...WORDS.map(() => [HIDE_TOOLTIP]),
        ]);

        await clickSuggestionAction(obsidian, snippet.displayName, EDIT_SNIPPET);
        expect(await waitForEntryModal(obsidian)).toEqual({
            title: EDIT_SNIPPET,
            name: snippet.displayName,
            replacement: snippet.replacement,
        });
        await expectText(obsidian, "hov<|>");

        await fillEntryModal(obsidian, "hovsnippet", "changed {{}} text");
        await clickModalButton(obsidian, "Save");
        await waitForNoModal(obsidian);

        // Typing continues where it was and suggests the renamed snippet with its new text
        await obsidian.type("s");
        await waitForItems(obsidian, ["hovsnippet"]);
        expect((await renderedItems(obsidian))[0].detail).toBe("changed {{}} text");
        await obsidian.press("Enter");
        await expectText(obsidian, "changed <|> text");
    });

    test("hiding a custom command with its button works like for other suggestions", async () => {
        const command = { displayName: "\\hovcmd", replacement: "\\hovcmd{#}" };
        await setLatexCommands([command]);
        try {
            await obsidian.openNote("$<|>$", { path: NOTE });
            await obsidian.type("\\hov");
            // Words are suggested in math, too
            await waitForItems(obsidian, [command.displayName, ...WORDS]);
            await clickSuggestionAction(obsidian, command.displayName, HIDE_ACTION);
            await waitForItems(obsidian, WORDS);
            expect((await obsidian.editor()).textWithCursor).toBe("$\\hov<|>$");
            expect(await blacklist()).toContain(command.displayName);
            // Hidden, but still one of the custom commands
            expect(
                await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.latex.customEntries.entries),
            ).toEqual([command]);
        } finally {
            await obsidian.eval(
                (name: string) => app.plugins.plugins["obsidian-completr"]!.blacklist.remove(name),
                command.displayName,
            );
        }
    });
});
