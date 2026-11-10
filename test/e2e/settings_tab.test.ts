import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, SortOrder } from "../../src/settings.ts";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import { startErrorCapture, takeErrors } from "./helpers/errors.ts";
import { clearNotices, waitForNotice } from "./helpers/notices.ts";
import {
    buttonTexts,
    chooseFiles,
    clickButton,
    clickExtraButton,
    clickListModalButton,
    clickListModalToolbarIcon,
    clickModalButton,
    clickToggle,
    closeSettings,
    closeTopModal,
    dropdownLabels,
    entryModal,
    fillEntryModal,
    filterListModal,
    getTextInput,
    groupHeadings,
    isSettingsTabOpen,
    isToggleOn,
    listModalDescriptions,
    listModalMessage,
    listModalNames,
    listModalToolbar,
    openCompletrSettings,
    readDataJson,
    selectDropdown,
    setTextInput,
    settingDescription,
    settingNames,
    topModalText,
    waitForEntryModal,
    waitForNoModal,
    waitForSettingName,
} from "./helpers/settings_tab.ts";
import {
    createVaultFile,
    deleteNotes,
    forgetScannedWords,
    isScanned,
    removeWordLists,
    setWordList,
} from "./helpers/words.ts";

let obsidian: Obsidian;
const NOTE = "settings-e2e.md";

beforeAll(async () => {
    obsidian = await getObsidian();
});
beforeEach(async () => {
    await obsidian.resetSettings();
});
afterEach(async () => {
    // Close leftover modals (e.g. after a failed test) and the settings. Newer Obsidian versions call the close
    // button "modal-header-button".
    await obsidian.eval(() => {
        for (const close of Array.from(
            document.querySelectorAll<HTMLElement>(
                ".modal:not(.mod-settings) > :is(.modal-close-button, .modal-header-button)",
            ),
        ))
            close.click();
    });
    await waitForNoModal(obsidian);
    await closeSettings(obsidian);
});
afterAll(async () => {
    await obsidian.resetSettings();
    await obsidian.openNote("", { path: "test.md" });
    await deleteNotes(obsidian, [NOTE]);
});

function settings() {
    return obsidian.eval(() => ({ ...app.plugins.plugins["obsidian-completr"]!.settings }));
}

async function waitForSaved<K extends keyof typeof DEFAULT_SETTINGS>(key: K, value: (typeof DEFAULT_SETTINGS)[K]) {
    await obsidian.waitFor(async () => (await readDataJson(obsidian))[key] === value, {
        what: `${key} = ${JSON.stringify(value)} in data.json`,
    });
}

test("renders all sections without errors", async () => {
    await startErrorCapture(obsidian);
    await openCompletrSettings(obsidian);
    expect(await isSettingsTabOpen(obsidian)).toBe(true);
    expect(await groupHeadings(obsidian)).toEqual([
        "Words",
        "File scanner",
        "Word lists",
        "LaTeX",
        "Snippets",
        "Front matter",
        "Callouts",
        "Blacklist",
    ]);
    expect(await settingNames(obsidian, null)).toContain("Open automatically");
    expect(await settingNames(obsidian, null)).toContain("Rank by usage");
    expect(await settingNames(obsidian, "Words")).toContain("Word characters");
    expect(await dropdownLabels(obsidian, "Words", "Matching and insertion")).toEqual([
        "Ignore case, insert the known word: 'Hello'",
        "Ignore case, keep what I typed: 'hello'",
        "Match case: 'Hello' is not suggested",
    ]);

    // The custom LaTeX commands and the snippets are a row in their group
    const commands = await waitForSettingName(obsidian, "LaTeX", /^\d+ custom commands?$/);
    expect(await buttonTexts(obsidian, "LaTeX", commands)).toEqual(["Manage", "Add LaTeX command"]);
    const snippets = await waitForSettingName(obsidian, "Snippets", /^\d+ snippets?$/);
    expect(await buttonTexts(obsidian, "Snippets", snippets)).toEqual(["Manage", "Add snippet"]);
    const blacklist = await waitForSettingName(obsidian, "Blacklist", /^\d+ blacklisted suggestions?$/);
    expect(await buttonTexts(obsidian, "Blacklist", blacklist)).toEqual(["Manage"]);

    const wordCount = await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.wordList.wordCount);
    expect(await settingDescription(obsidian, "Word lists", "Word list files")).toEndWith(
        `${wordCount} ${wordCount === 1 ? "word" : "words"} loaded.`,
    );
    // Rendering happens partly asynchronously (word list files)
    await Bun.sleep(100);
    expect(await takeErrors(obsidian)).toEqual([]);

    await closeSettings(obsidian);
    expect(await isSettingsTabOpen(obsidian)).toBe(false);
});

test("toggles, dropdowns and numbers are saved to data.json", async () => {
    await openCompletrSettings(obsidian);
    expect(await isToggleOn(obsidian, "Words", "Fuzzy matching")).toBe(false);
    await clickToggle(obsidian, "Words", "Fuzzy matching");
    expect(await isToggleOn(obsidian, "Words", "Fuzzy matching")).toBe(true);
    await waitForSaved("fuzzyMatching", true);
    expect((await settings()).fuzzyMatching).toBe(true);

    await clickToggle(obsidian, "File scanner", "Only words from the current note");
    await waitForSaved("fileScannerCurrentFileOnly", true);
    await clickToggle(obsidian, "File scanner", "Only words from the current note");
    await waitForSaved("fileScannerCurrentFileOnly", false);

    await selectDropdown(obsidian, "Words", "Sort order", SortOrder.ALPHABETICAL);
    await waitForSaved("sortOrder", SortOrder.ALPHABETICAL);

    await setTextInput(obsidian, "Words", "Minimum word length", "5");
    await waitForSaved("minWordLength", 5);
    // Below the minimum: ignored
    await setTextInput(obsidian, "Words", "Minimum word length", "0");
    await Bun.sleep(100);
    expect((await readDataJson(obsidian)).minWordLength).toBe(5);

    // The settings tab shows the saved values when opened again
    await closeSettings(obsidian);
    await openCompletrSettings(obsidian);
    expect(await isToggleOn(obsidian, "Words", "Fuzzy matching")).toBe(true);
    expect(await getTextInput(obsidian, "Words", "Minimum word length")).toBe("5");
});

test("an invalid word characters regex is marked and not saved", async () => {
    await openCompletrSettings(obsidian);
    expect(await getTextInput(obsidian, "Words", "Word characters")).toBe(DEFAULT_SETTINGS.characterRegex);

    for (const invalid of ["\\p{NoSuchProperty}", "z-a", ""]) {
        const classes = await setTextInput(obsidian, "Words", "Word characters", invalid);
        expect(classes, invalid).toContain("completr-settings-error");
    }
    await Bun.sleep(100);
    expect((await readDataJson(obsidian)).characterRegex).toBe(DEFAULT_SETTINGS.characterRegex);
    expect((await settings()).characterRegex).toBe(DEFAULT_SETTINGS.characterRegex);

    const classes = await setTextInput(obsidian, "Words", "Word characters", "a-z0-9");
    expect(classes).not.toContain("completr-settings-error");
    await waitForSaved("characterRegex", "a-z0-9");
});

test("sorting language is only shown for alphabetical sorting", async () => {
    await openCompletrSettings(obsidian);
    expect(await settingNames(obsidian, "Words")).not.toContain("Sorting language");
    await selectDropdown(obsidian, "Words", "Sort order", SortOrder.ALPHABETICAL);
    await waitForSettingName(obsidian, "Words", /^Sorting language$/);
    await setTextInput(obsidian, "Words", "Sorting language", " sv ");
    await waitForSaved("sortLocale", "sv");

    await selectDropdown(obsidian, "Words", "Sort order", SortOrder.LONGEST_FIRST);
    await obsidian.waitFor(async () => !(await settingNames(obsidian, "Words")).includes("Sorting language"), {
        what: "the sorting language to disappear",
    });
    // The value is kept
    expect((await settings()).sortLocale).toBe("sv");
});

test("the reset button of 'Rank by usage' forgets how often suggestions were used", async () => {
    const original = await obsidian.eval(async () => {
        const plugin = app.plugins.plugins["obsidian-completr"]!;
        await plugin.usage.flush();
        return plugin.files.read("suggestion_usage.json");
    });
    try {
        await obsidian.eval(() => {
            const usage = app.plugins.plugins["obsidian-completr"]!.usage;
            usage.record("usageresetzz");
            usage.record("usageresetzz");
        });
        expect(await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.usage.get("usageresetzz"))).toBe(2);
        await clearNotices(obsidian);
        await openCompletrSettings(obsidian);
        await clickExtraButton(obsidian, null, "Rank by usage", "Forget how often suggestions were used");
        await waitForNotice(obsidian, "Completr: Usage counts were reset");
        const after = await obsidian.eval(() => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            return { count: plugin.usage.get("usageresetzz"), size: plugin.usage.size };
        });
        expect(after).toEqual({ count: 0, size: 0 });
        // The toggle next to it is untouched
        expect(await isToggleOn(obsidian, null, "Rank by usage")).toBe((await settings()).rankByUsage);
    } finally {
        // Other test files insert suggestions, too: put their counts back
        await obsidian.eval(async (original: string | null) => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            await plugin.usage.clear();
            if (original === null) await plugin.files.remove("suggestion_usage.json");
            else await plugin.files.write("suggestion_usage.json", original);
            await plugin.usage.load();
        }, original);
    }
});

describe("file scanner row", () => {
    const NOTE_WORD = "rowscanwordzz";
    const UNOPENED = "settings-e2e-unopened.md";
    let snapshot: string | null;

    // "Scan vault" learns the words of every test note and "Forget all" forgets everything, so the known words of
    // the other test files are put back afterwards.
    beforeAll(async () => {
        snapshot = await obsidian.eval(async () => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            await plugin.fileScanner.flush();
            return plugin.files.read("scanned_words.txt");
        });
    });
    afterAll(async () => {
        await deleteNotes(obsidian, [UNOPENED]);
        await obsidian.eval(async (snapshot: string | null) => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            await plugin.files.write("scanned_words.txt", snapshot ?? "");
            await plugin.fileScanner.load(plugin.settings);
        }, snapshot);
    });

    function knownWordsLabel() {
        return obsidian.eval(() => {
            const count = app.plugins.plugins["obsidian-completr"]!.fileScanner.wordCount;
            return `${count} known ${count === 1 ? "word" : "words"}`;
        });
    }

    test("'Scan vault' learns the words of notes that were never opened, without asking", async () => {
        await createVaultFile(obsidian, UNOPENED, `Contains ${NOTE_WORD} only here.`);
        expect(await isScanned(obsidian, NOTE_WORD)).toBe(false);
        await clearNotices(obsidian);
        await openCompletrSettings(obsidian);
        const before = await waitForSettingName(obsidian, "File scanner", /^\d+ known words?$/);
        expect(before).toBe(await knownWordsLabel());
        expect(await buttonTexts(obsidian, "File scanner", before)).toEqual(["Forget all", "Scan vault"]);

        await clickButton(obsidian, "File scanner", before, "Scan vault");
        const notice = await waitForNotice(obsidian, "Completr: Scanned");
        expect(await topModalText(obsidian)).toBeNull();
        expect(await isScanned(obsidian, NOTE_WORD)).toBe(true);
        const [notes, words] = await obsidian.eval(() => [
            app.vault.getMarkdownFiles().length,
            app.plugins.plugins["obsidian-completr"]!.fileScanner.wordCount,
        ]);
        expect(notice).toBe(`Completr: Scanned ${notes} notes, ${words} known words`);
        // The row shows the new count
        const label = await knownWordsLabel();
        await waitForSettingName(obsidian, "File scanner", new RegExp(`^${label}$`));
    });

    test("'Forget all' forgets all known words after confirmation", async () => {
        await openCompletrSettings(obsidian);
        const before = await waitForSettingName(obsidian, "File scanner", /^\d+ known words?$/);
        expect(before).not.toBe("0 known words");

        // Cancel keeps them
        await clickButton(obsidian, "File scanner", before, "Forget all");
        expect(await topModalText(obsidian)).toContain("Forget all known words?");
        await clickModalButton(obsidian, "Cancel");
        await waitForNoModal(obsidian);
        expect(await settingNames(obsidian, "File scanner")).toContain(before);

        await clickButton(obsidian, "File scanner", before, "Forget all");
        await clickModalButton(obsidian, "Forget all");
        await waitForNoModal(obsidian);
        await waitForSettingName(obsidian, "File scanner", /^0 known words$/);
        expect(await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.fileScanner.wordCount)).toBe(0);
        expect(await Bun.file(join(obsidian.pluginDir, "scanned_words.txt")).text()).toBe("");
    });
});

describe("blacklist", () => {
    const WORDS = ["blackwordalpha", "blackwordbeta"];
    let originalBlacklist: string | null = null;

    async function blacklistFile() {
        const path = join(obsidian.pluginDir, "blacklisted_suggestions.txt");
        return existsSync(path) ? await Bun.file(path).text() : null;
    }

    beforeAll(async () => {
        // Start without a blacklist file, to check that it gets created (#78)
        originalBlacklist = await obsidian.eval(async () => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            const original = await plugin.files.read("blacklisted_suggestions.txt");
            await plugin.files.remove("blacklisted_suggestions.txt");
            await plugin.blacklist.load();
            return original;
        });
        await setWordList(obsidian, "e2e-blacklist.txt", WORDS);
    });
    afterAll(async () => {
        await obsidian.eval(async (original: string | null) => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            if (original === null) await plugin.files.remove("blacklisted_suggestions.txt");
            else await plugin.files.write("blacklisted_suggestions.txt", original);
            await plugin.blacklist.load();
        }, originalBlacklist);
        await removeWordLists(obsidian, "e2e-blacklist.txt");
        await forgetScannedWords(obsidian, WORDS);
    });

    test("Mod+Shift+D blacklists the selected suggestion and creates the file in the plugin folder (#78)", async () => {
        expect(await blacklistFile()).toBeNull();
        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("blackw");
        await obsidian.waitForPopup((p) => p.items[0] === "blackwordbeta" && p.items.includes("blackwordalpha"));
        await obsidian.press("D", "Mod", "Shift");
        // The popup updates right away
        const popup = await obsidian.waitForPopup((p) => !p.items.includes("blackwordbeta"));
        expect(popup.items).toContain("blackwordalpha");
        expect((await obsidian.editor()).text).toBe("blackw");

        await obsidian.waitFor(async () => (await blacklistFile()) === "blackwordbeta", {
            what: "the blacklist file",
        });
        const pluginFolder = await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.manifest.dir);
        expect(pluginFolder).toBe(".obsidian/plugins/obsidian-completr");

        await obsidian.press("D", "Mod", "Shift");
        await obsidian.waitFor(async () => !(await obsidian.popup()).visible, { what: "the popup to close" });
        await obsidian.waitFor(async () => (await blacklistFile()) === "blackwordbeta\nblackwordalpha", {
            what: "the blacklist file",
        });
        expect((await obsidian.editor()).text).toBe("blackw");
    });

    test("the settings list the blacklisted suggestions, which can be filtered and removed (#23)", async () => {
        await obsidian.eval(async (words: string[]) => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            for (const w of words) await plugin.blacklistSuggestion(w);
        }, WORDS);
        await openCompletrSettings(obsidian);
        // The settings only show the count, the list is in a modal
        expect(await settingNames(obsidian, "Blacklist")).toEqual(["2 blacklisted suggestions"]);
        await clickButton(obsidian, "Blacklist", "2 blacklisted suggestions", "Manage");
        expect(await listModalNames(obsidian)).toEqual(WORDS);
        expect(await listModalMessage(obsidian)).toBeNull();

        await filterListModal(obsidian, "BETA");
        expect(await listModalNames(obsidian)).toEqual(["blackwordbeta"]);
        expect(await listModalMessage(obsidian)).toBe("1 of 2 entries");
        await filterListModal(obsidian, "nothing like this");
        expect(await listModalNames(obsidian)).toEqual([]);
        expect(await listModalMessage(obsidian)).toBe("Nothing matches the filter.");
        await filterListModal(obsidian, "");

        await clickListModalButton(obsidian, "blackwordalpha", "Remove from blacklist");
        await obsidian.waitFor(async () => JSON.stringify(await listModalNames(obsidian)) === '["blackwordbeta"]', {
            what: "the entry to disappear",
        });
        expect(await blacklistFile()).toBe("blackwordbeta");

        await clickListModalButton(obsidian, "blackwordbeta", "Remove from blacklist");
        await obsidian.waitFor(async () => (await listModalNames(obsidian))?.length === 0, {
            what: "the list to be empty",
        });
        expect(await listModalMessage(obsidian)).toBe("No suggestions are blacklisted.");
        expect(await blacklistFile()).toBe("");

        // Closing the modal updates the count
        await closeTopModal(obsidian);
        await obsidian.waitFor(
            async () => JSON.stringify(await settingNames(obsidian, "Blacklist")) === '["0 blacklisted suggestions"]',
            { what: "the count to update" },
        );
    });

    test("a word list word removed from the blacklist is suggested again", async () => {
        await obsidian.eval(async () => {
            await app.plugins.plugins["obsidian-completr"]!.blacklistSuggestion("blackwordalpha");
        });
        await openCompletrSettings(obsidian);
        await clickButton(obsidian, "Blacklist", "1 blacklisted suggestion", "Manage");
        await clickListModalButton(obsidian, "blackwordalpha", "Remove from blacklist");
        await obsidian.waitFor(async () => (await listModalNames(obsidian))?.length === 0, {
            what: "the list to be empty",
        });
        await closeTopModal(obsidian);
        await closeSettings(obsidian);

        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("blackw");
        await obsidian.waitForPopup((p) => p.items.includes("blackwordalpha"));
    });
});

test("custom LaTeX commands can be added, edited and removed", async () => {
    const original = await obsidian.eval(() =>
        app.plugins.plugins["obsidian-completr"]!.latex.customEntries.entries.map((c) => ({ ...c })),
    );
    try {
        await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.latex.customEntries.set([]));
        await openCompletrSettings(obsidian);
        await clickButton(obsidian, "LaTeX", "0 custom commands", "Add LaTeX command");
        expect(await topModalText(obsidian)).toContain("Add LaTeX command");

        // An empty replacement is rejected
        await clickModalButton(obsidian, "Add");
        expect(await topModalText(obsidian)).toContain("Add LaTeX command");

        await fillEntryModal(obsidian, "\\eecmd", "\\eecmd{#}");
        await clickModalButton(obsidian, "Add");
        await waitForNoModal(obsidian);
        await waitForSettingName(obsidian, "LaTeX", /^1 custom command$/);

        // Edit it in the list
        await clickButton(obsidian, "LaTeX", "1 custom command", "Manage");
        expect(await listModalNames(obsidian)).toEqual(["\\eecmd"]);
        await clickListModalButton(obsidian, "\\eecmd", "Edit");
        expect(await topModalText(obsidian)).toContain("Edit LaTeX command");
        await fillEntryModal(obsidian, null, "\\eecmd{#}{#}");
        await clickModalButton(obsidian, "Save");
        await obsidian.waitFor(async () => (await topModalText(obsidian))?.includes("\\eecmd{#}{#}"), {
            what: "the list to show the new replacement",
        });
        const file = await Bun.file(join(obsidian.pluginDir, "latex_commands.json")).text();
        expect(JSON.parse(file)).toEqual([{ displayName: "\\eecmd", replacement: "\\eecmd{#}{#}" }]);
        await closeTopModal(obsidian);
        await closeSettings(obsidian);

        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("$\\eec");
        await obsidian.waitForPopup((p) => p.items[0] === "\\eecmd");
        await obsidian.press("Enter");
        expect((await obsidian.editor()).text).toContain("$\\eecmd{}{}");

        await openCompletrSettings(obsidian);
        await clickButton(obsidian, "LaTeX", "1 custom command", "Manage");
        await clickListModalButton(obsidian, "\\eecmd", "Remove");
        await obsidian.waitFor(async () => (await listModalNames(obsidian))?.length === 0, {
            what: "the command to be removed",
        });
        expect(await listModalMessage(obsidian)).toBe("No custom commands yet.");
        await closeTopModal(obsidian);
        const after = await Bun.file(join(obsidian.pluginDir, "latex_commands.json")).text();
        expect(after).not.toContain("eecmd");
        // Closing the list updates the count
        await waitForSettingName(obsidian, "LaTeX", /^0 custom commands$/);
    } finally {
        await obsidian.eval(async (commands) => {
            await app.plugins.plugins["obsidian-completr"]!.latex.customEntries.set(commands);
        }, original);
    }
});

describe("snippets in the settings", () => {
    const SNIPPETS_FILE = "snippets.json";
    const SIG = { displayName: "setsig", replacement: "Best regards\nTim\nExample Ltd." };
    const TODO = { displayName: "settodo", replacement: "- [ ] {{}}" };
    let original: { displayName: string; replacement: string }[];

    function setSnippets(entries: { displayName: string; replacement: string }[]) {
        return obsidian.eval(
            (entries: { displayName: string; replacement: string }[]) =>
                app.plugins.plugins["obsidian-completr"]!.snippets.customEntries.set(entries),
            entries,
        );
    }

    beforeAll(async () => {
        original = await obsidian.eval(() =>
            app.plugins.plugins["obsidian-completr"]!.snippets.customEntries.entries.map((c) => ({ ...c })),
        );
    });
    beforeEach(() => setSnippets([SIG, TODO]));
    afterAll(() => setSnippets(original));

    test("the list summarizes multi-line snippets in one line and has the file buttons next to the filter", async () => {
        await openCompletrSettings(obsidian);
        await clickButton(obsidian, "Snippets", "2 snippets", "Manage");
        expect(await listModalNames(obsidian)).toEqual([SIG.displayName, TODO.displayName]);
        expect(await listModalDescriptions(obsidian)).toEqual({
            [SIG.displayName]: "Best regards ⏎ Tim …",
            [TODO.displayName]: "- [ ] {{}}",
        });
        expect(await listModalToolbar(obsidian)).toEqual({
            icons: [`Open ${SNIPPETS_FILE} in the default app`, `Reload ${SNIPPETS_FILE}`],
            buttons: ["Add snippet"],
        });
    });

    test("Reload picks up changes made to the file outside of Obsidian", async () => {
        await openCompletrSettings(obsidian);
        await clickButton(obsidian, "Snippets", "2 snippets", "Manage");
        await clearNotices(obsidian);

        const edited = [TODO, { displayName: "setdisk", replacement: "from disk" }, SIG];
        await Bun.write(join(obsidian.pluginDir, SNIPPETS_FILE), JSON.stringify(edited));
        await clickListModalToolbarIcon(obsidian, `Reload ${SNIPPETS_FILE}`);
        await obsidian.waitFor(
            async () =>
                JSON.stringify(await listModalNames(obsidian)) === JSON.stringify(edited.map((e) => e.displayName)),
            { what: "the list to show the file's entries" },
        );
        await waitForNotice(obsidian, `Completr: Loaded 3 snippets from ${SNIPPETS_FILE}`);
        await closeTopModal(obsidian);
        await waitForSettingName(obsidian, "Snippets", /^3 snippets$/);
        await closeSettings(obsidian);

        // Suggested right away
        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("setd");
        await obsidian.waitForPopup((p) => p.items[0] === "setdisk");
        await obsidian.press("Escape");
    });

    test("a name another snippet already has is rejected", async () => {
        await clearNotices(obsidian);
        await openCompletrSettings(obsidian);
        await clickButton(obsidian, "Snippets", "2 snippets", "Add snippet");
        await waitForEntryModal(obsidian);
        await fillEntryModal(obsidian, TODO.displayName, "something else");
        await clickModalButton(obsidian, "Add");
        await waitForNotice(obsidian, `There already is a snippet named "${TODO.displayName}".`);
        // The dialog stays open with what was entered, nothing was saved
        expect(await entryModal(obsidian)).toEqual({
            title: "Add snippet",
            name: TODO.displayName,
            replacement: "something else",
        });
        expect(
            await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.snippets.customEntries.entries),
        ).toEqual([SIG, TODO]);

        // Renaming an existing one to the name of another is rejected as well, keeping its own name is fine
        await closeTopModal(obsidian);
        await clickButton(obsidian, "Snippets", "2 snippets", "Manage");
        await clickListModalButton(obsidian, SIG.displayName, "Edit");
        await waitForEntryModal(obsidian);
        await fillEntryModal(obsidian, TODO.displayName, null);
        await clearNotices(obsidian);
        await clickModalButton(obsidian, "Save");
        await waitForNotice(obsidian, `There already is a snippet named "${TODO.displayName}".`);
        expect((await entryModal(obsidian))?.title).toBe("Edit snippet");

        await fillEntryModal(obsidian, SIG.displayName, "Cheers");
        await clickModalButton(obsidian, "Save");
        await obsidian.waitFor(async () => (await entryModal(obsidian)) === null, { what: "the dialog to close" });
        expect(await listModalDescriptions(obsidian)).toEqual({
            [SIG.displayName]: "Cheers",
            [TODO.displayName]: "- [ ] {{}}",
        });
    });
});

describe("word list import", () => {
    let dir: string;
    const UTF16 = "e2e-import-utf16.txt";
    const CP1252 = "e2e-import-cp1252.txt";

    beforeAll(async () => {
        dir = mkdtempSync(join(tmpdir(), "completr-e2e-import-"));
        const utf16 = Buffer.concat([
            Buffer.from([0xff, 0xfe]),
            Buffer.from("Größenwahn\r\nÜberschwang\r\n", "utf16le"),
        ]);
        await Bun.write(join(dir, UTF16), utf16);
        // All characters used are in Latin-1, where Windows-1252 has the same byte values
        await Bun.write(join(dir, CP1252), Buffer.from("Mädchenzimmer\nÖlfaß\n", "latin1"));
    });
    afterAll(async () => {
        rmSync(dir, { recursive: true, force: true });
        await removeWordLists(obsidian, UTF16, CP1252);
        await forgetScannedWords(obsidian, ["Größ", "Ölf"]);
    });

    test("imports UTF-16 and Windows-1252 files through the file dialog and deletes them", async () => {
        await startErrorCapture(obsidian);
        await openCompletrSettings(obsidian);
        await chooseFiles(obsidian, () => clickButton(obsidian, "Word lists", "Word list files", "Import"), [
            join(dir, UTF16),
            join(dir, CP1252),
        ]);
        await obsidian.waitFor(
            async () => {
                const names = await settingNames(obsidian, "Word lists");
                return names.includes(UTF16) && names.includes(CP1252);
            },
            { what: "the imported files in the list" },
        );
        // Stored as UTF-8
        const wordLists = join(obsidian.pluginDir, "wordLists");
        expect((await Bun.file(join(wordLists, UTF16)).text()).split(/\r?\n/)).toEqual([
            "Größenwahn",
            "Überschwang",
            "",
        ]);
        expect((await Bun.file(join(wordLists, CP1252)).text()).split("\n")).toEqual(["Mädchenzimmer", "Ölfaß", ""]);
        await closeSettings(obsidian);

        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("Größ");
        await obsidian.waitForPopup((p) => p.items[0] === "Größenwahn");
        await obsidian.press("Escape");
        await obsidian.type(" Ölf");
        await obsidian.waitForPopup((p) => p.items[0] === "Ölfaß");
        await obsidian.press("Escape");

        // Delete one of them again
        await openCompletrSettings(obsidian);
        await obsidian.waitFor(async () => (await settingNames(obsidian, "Word lists")).includes(UTF16), {
            what: "the word list files", // rendered asynchronously
        });
        await clickExtraButton(obsidian, "Word lists", UTF16, "Remove");
        expect(await topModalText(obsidian)).toContain(`Delete ${UTF16}?`);
        await clickModalButton(obsidian, "Delete");
        await obsidian.waitFor(async () => !(await settingNames(obsidian, "Word lists")).includes(UTF16), {
            what: "the file to disappear from the list",
        });
        expect(existsSync(join(wordLists, UTF16))).toBe(false);
        expect(await settingNames(obsidian, "Word lists")).toContain(CP1252);
        await closeSettings(obsidian);

        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("Größ");
        await obsidian.expectNoPopup();
        expect(await takeErrors(obsidian)).toEqual([]);
    });
});
