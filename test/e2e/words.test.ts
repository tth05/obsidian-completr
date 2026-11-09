import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import {
    deleteNotes,
    forgetScannedWords,
    forgetUsage,
    isScanned,
    removeWordLists,
    renderedItems,
    setWordList,
    waitForScanned,
} from "./helpers/words.ts";
import { IconMode, SortOrder, WordInsertionMode } from "../../src/settings.ts";

let obsidian: Obsidian;
const notes: string[] = [];
const wordLists: string[] = [];
const scannedWords: string[] = [];

/** Opens a note at a fresh path, so a `file-open` (and with it a scan) happens. */
let noteCounter = 0;
async function openFreshNote(content: string) {
    const path = `words-e2e-${++noteCounter}.md`;
    notes.push(path);
    await obsidian.openNote(content, { path });
    return path;
}

async function wordList(name: string, words: string[]) {
    if (!wordLists.includes(name)) wordLists.push(name);
    await setWordList(obsidian, name, words);
}

beforeAll(async () => {
    obsidian = await getObsidian();
});
beforeEach(async () => {
    await obsidian.resetSettings();
});
afterAll(async () => {
    await obsidian.openNote("", { path: "test.md" });
    await deleteNotes(obsidian, notes);
    await removeWordLists(obsidian, ...wordLists);
    // Words inserted from word lists were learned by the scanner, too
    const inserted = ["xylophonist", "καλημέρα", "अँकाउनु", "āṣīṛū", "mindful", "markdown", "rankwordlonger"];
    await forgetScannedWords(obsidian, [...scannedWords, ...inserted, "codeb", "exactwords", "mkd", "sch", "asi"]);
    await forgetUsage(obsidian, inserted);
});

describe("file scanner", () => {
    test("suggests the words of the opened note", async () => {
        scannedWords.push("xylophonist", "Quokkaland");
        await openFreshNote("The xylophonist from Quokkaland.\n<|>");
        await obsidian.type("xylo");
        expect((await obsidian.waitForPopup((p) => p.items.includes("xylophonist"))).items[0]).toBe("xylophonist");
        await obsidian.press("Enter");
        expect((await obsidian.editor()).textWithCursor).toBe("The xylophonist from Quokkaland.\nxylophonist<|>");

        await obsidian.type(" quok");
        await obsidian.waitForPopup((p) => p.items[0] === "Quokkaland");
    });

    test("learns all words of an opened note, including the one at the cursor", async () => {
        scannedWords.push("Firstwordzz", "lastwordzz");
        await openFreshNote("Firstwordzz and lastwordzz");
        await waitForScanned(obsidian, "Firstwordzz");
        await waitForScanned(obsidian, "lastwordzz", 1_500);
    });

    test("learns words typed in the current note after a moment, but not the word being typed (#59, #19)", async () => {
        scannedWords.push("quintessentially", "quintess");
        await openFreshNote("Start ");
        await obsidian.type("quintessentially quintess");
        await waitForScanned(obsidian, "quintessentially");
        // The scan ran with the cursor at the end of "quintess", which might be incomplete
        expect(await isScanned(obsidian, "quintess")).toBe(false);

        await obsidian.type(" quinte");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("quintessentially"));
        expect(popup.items).not.toContain("quintess");
    });

    test("only suggests words of the current note if configured (#19)", async () => {
        scannedWords.push("otherfileword", "thisfileword");
        await openFreshNote("Contains otherfileword.\n");
        await waitForScanned(obsidian, "otherfileword");
        await openFreshNote("Contains thisfileword.\n<|>");

        await obsidian.type("otherf");
        await obsidian.waitForPopup((p) => p.items.includes("otherfileword"));
        await obsidian.press("Escape");

        await obsidian.setSettings({ fileScannerCurrentFileOnly: true });
        await obsidian.type(" thisf");
        await obsidian.waitForPopup((p) => p.items.includes("thisfileword"));
        await obsidian.press("Escape");
        await obsidian.type(" otherf");
        await obsidian.expectNoPopup();
    });

    test("learns words in brackets and links, but not URLs, math and code (#99)", async () => {
        const learned = ["Ryder", "Somelinkword", "Linkpagezz", "Labelwordzz", "dollarwordzz"];
        const skipped = ["urlwordzz", "mathwordzz", "codewordzz", "fencedwordzz", "destwordzz", "blockmathzz"];
        scannedWords.push(...learned, ...skipped);
        await openFreshNote(
            [
                "Intro: [Ryder] met [[Somelinkword Linkpagezz]].",
                "See https://example.com/urlwordzz and $mathwordzz$ and `codewordzz`.",
                "[Labelwordzz](https://example.com/destwordzz)",
                // Not math, like in Obsidian: a "$" followed by a digit doesn't close
                "Costs $5 and dollarwordzz $6.",
                "```",
                "fencedwordzz",
                "```",
                "$$",
                "blockmathzz",
                "$$",
                "<|>",
            ].join("\n"),
        );
        for (const word of learned) await waitForScanned(obsidian, word);
        for (const word of skipped) expect(await isScanned(obsidian, word), word).toBe(false);

        await obsidian.type("Ryd");
        await obsidian.waitForPopup((p) => p.items.includes("Ryder"));
    });

    test("persists scanned words to scanned_words.txt", async () => {
        scannedWords.push("persistedscanword");
        await openFreshNote("Some persistedscanword here.\n");
        await waitForScanned(obsidian, "persistedscanword");
        const content = await obsidian.eval(async () => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            await plugin.fileScanner.flush();
            return plugin.files.read("scanned_words.txt");
        });
        expect(content!.split("\n")).toContain("persistedscanword");
        // Written to the plugin folder of the vault
        expect(await Bun.file(`${obsidian.pluginDir}/scanned_words.txt`).text()).toBe(content!);
    });
});

describe("word lists", () => {
    test("Greek words are suggested with the default settings (#85)", async () => {
        await wordList("e2e-greek.txt", ["καλημέρα", "καλησπέρα", "ευχαριστώ"]);
        await openFreshNote("<|>");
        await obsidian.type("καλη");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("καλησπέρα"));
        expect(popup.items.slice(0, 2)).toEqual(["καλημέρα", "καλησπέρα"]);
        await obsidian.press("Enter");
        expect((await obsidian.editor()).text).toBe("καλημέρα");
    });

    test("Devanagari words with combining vowel signs are suggested (#87)", async () => {
        await wordList("e2e-devanagari.txt", ["अँकाउनु", "अँगालो", "किताब"]);
        await openFreshNote("<|>");
        await obsidian.type("अँका");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("अँकाउनु"));
        expect(popup.items).not.toContain("अँगालो");
        await obsidian.press("Enter");
        expect((await obsidian.editor()).text).toBe("अँकाउनु");

        await obsidian.type(" कित");
        await obsidian.waitForPopup((p) => p.items[0] === "किताब");
    });

    test("ignoring diacritics in append mode inserts the word with its diacritics (#98)", async () => {
        await wordList("e2e-diacritics.txt", ["āṣīṛū"]);
        await obsidian.setSettings({
            wordInsertionMode: WordInsertionMode.IGNORE_CASE_APPEND,
            ignoreDiacriticsWhenFiltering: true,
        });
        await openFreshNote("<|>");
        await obsidian.type("asi");
        await obsidian.waitForPopup((p) => p.items[0] === "āṣīṛū");
        await obsidian.press("Enter");
        expect((await obsidian.editor()).textWithCursor).toBe("āṣīṛū<|>");
    });

    test("without ignoring diacritics, the plain letters don't match", async () => {
        await wordList("e2e-diacritics.txt", ["āṣīṛū"]);
        await openFreshNote("<|>");
        await obsidian.type("asi");
        await obsidian.expectNoPopup();
    });

    test("words shorter than the minimum word length are hidden, even if known (#71)", async () => {
        await wordList("e2e-mind.txt", ["mind", "mindful", "mindfulness"]);
        await openFreshNote("<|>");
        await obsidian.type("min");
        await obsidian.waitForPopup((p) => p.items[0] === "mind");
        await obsidian.press("Escape");

        await obsidian.setSettings({ minWordLength: 6 });
        await obsidian.type(" min");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("mindful"));
        expect(popup.items).not.toContain("mind");
    });

    test("inserts a space after the word if configured (#38)", async () => {
        await wordList("e2e-mind.txt", ["mind", "mindful", "mindfulness"]);
        await obsidian.setSettings({ insertSpaceAfterWord: true });
        await openFreshNote("<|>");
        await obsidian.type("mindfu");
        await obsidian.waitForPopup((p) => p.items[0] === "mindful");
        await obsidian.press("Enter");
        expect((await obsidian.editor()).textWithCursor).toBe("mindful <|>");

        // No second space if there already is whitespace after the cursor
        await openFreshNote("<|> rest");
        await obsidian.type("mindfu");
        await obsidian.waitForPopup((p) => p.items[0] === "mindful");
        await obsidian.press("Enter");
        expect((await obsidian.editor()).textWithCursor).toBe("mindful<|> rest");
    });

    describe("sort order", () => {
        const words = ["schwer", "schütteln", "schön", "schälen", "schreiben", "schaufel", "schorf"];
        const set = new Set(words);

        async function suggestedOrder() {
            await openFreshNote("<|>");
            await obsidian.type("sch");
            const popup = await obsidian.waitForPopup((p) => p.items.filter((i) => set.has(i)).length === 7);
            return popup.items.filter((i) => set.has(i));
        }

        beforeEach(async () => {
            await wordList("e2e-sorting.txt", words);
            await forgetUsage(obsidian, words);
        });

        test("shortest first", async () => {
            const lengths = (await suggestedOrder()).map((w) => w.length);
            expect(lengths).toEqual(lengths.toSorted((a, b) => a - b));
        });

        test("longest first", async () => {
            await obsidian.setSettings({ sortOrder: SortOrder.LONGEST_FIRST });
            const lengths = (await suggestedOrder()).map((w) => w.length);
            expect(lengths).toEqual(lengths.toSorted((a, b) => b - a));
        });

        test("alphabetical in German sorts umlauts like their base letter (#75, #81)", async () => {
            await obsidian.setSettings({ sortOrder: SortOrder.ALPHABETICAL, sortLocale: "de" });
            expect(await suggestedOrder()).toEqual([
                "schälen",
                "schaufel",
                "schön",
                "schorf",
                "schreiben",
                "schütteln",
                "schwer",
            ]);
        });

        test("alphabetical in Swedish sorts ä and ö after z", async () => {
            await obsidian.setSettings({ sortOrder: SortOrder.ALPHABETICAL, sortLocale: "sv" });
            expect(await suggestedOrder()).toEqual([
                "schaufel",
                "schorf",
                "schreiben",
                "schwer",
                "schütteln",
                "schälen",
                "schön",
            ]);
        });
    });

    test("fuzzy matching suggests subsequences after prefix matches and highlights them (#57, #27)", async () => {
        await wordList("e2e-fuzzy.txt", ["markdown", "mkdir", "milkman"]);
        await openFreshNote("<|>");
        await obsidian.type("mkd");
        // Only the prefix match without fuzzy matching
        await obsidian.waitForPopup((p) => p.items.includes("mkdir"));
        expect((await obsidian.popup()).items).not.toContain("markdown");
        await obsidian.press("Escape");

        await obsidian.setSettings({ fuzzyMatching: true });
        await obsidian.type(" mkd");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("markdown"));
        expect(popup.items[0]).toBe("mkdir");
        expect(popup.items).not.toContain("milkman");

        const items = await renderedItems(obsidian);
        expect(items.find((i) => i.text === "mkdir")!.highlights).toEqual(["mkd"]);
        expect(items.find((i) => i.text === "markdown")!.highlights).toEqual(["m", "kd"]);

        await obsidian.press("ArrowDown");
        await obsidian.press("Enter");
        expect((await obsidian.editor()).textWithCursor).toBe("mkd markdown<|>");
    });

    test("words can be disabled inside code (#93)", async () => {
        await wordList("e2e-code.txt", ["codeblockword"]);
        const note = "```\n<|>\n```\nText `inline ` end";
        await openFreshNote(note);
        await obsidian.type("codeb");
        await obsidian.waitForPopup((p) => p.items.includes("codeblockword"));
        await obsidian.press("Escape");

        await obsidian.setSettings({ disableWordsInCode: true });
        await openFreshNote(note);
        await obsidian.type("codeb");
        await obsidian.expectNoPopup();

        // Inline code
        await openFreshNote("Text `inline <|>` end");
        await obsidian.type("codeb");
        await obsidian.expectNoPopup();

        // Outside of code it still works
        await openFreshNote("```\ncode\n```\n<|>");
        await obsidian.type("codeb");
        await obsidian.waitForPopup((p) => p.items.includes("codeblockword"));
    });

    test("frequently inserted words move up (rank by usage)", async () => {
        const words = ["rankword", "rankwordlonger"];
        await wordList("e2e-rank.txt", words);
        await forgetUsage(obsidian, words);
        await openFreshNote("<|>");

        for (let i = 0; i < 2; i++) {
            await obsidian.type(i === 0 ? "rankw" : " rankw");
            await obsidian.waitForPopup((p) => p.items.includes("rankwordlonger"));
            const popup = await obsidian.popup();
            const index = popup.items.indexOf("rankwordlonger");
            for (let j = 0; j < index; j++) await obsidian.press("ArrowDown");
            await obsidian.press("Enter");
        }
        expect((await obsidian.editor()).text).toBe("rankwordlonger rankwordlonger");

        await obsidian.type(" rankw");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("rankword"));
        expect(popup.items.slice(0, 2)).toEqual(["rankwordlonger", "rankword"]);

        // Without ranking by usage, the shortest word comes first again
        await obsidian.press("Escape");
        await obsidian.setSettings({ rankByUsage: false });
        await obsidian.type(" rankw");
        const unranked = await obsidian.waitForPopup((p) => p.items.includes("rankword"));
        expect(unranked.items.slice(0, 2)).toEqual(["rankword", "rankwordlonger"]);
        await forgetUsage(obsidian, words);
    });

    test("the exact typed word is not suggested", async () => {
        await wordList("e2e-exact.txt", ["exactword", "exactwords"]);
        await openFreshNote("<|>");
        await obsidian.type("exactword");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("exactwords"));
        expect(popup.items).not.toContain("exactword");
        // Typing the rest of the only remaining suggestion closes the popup
        await obsidian.type("s");
        await obsidian.waitFor(async () => !(await obsidian.popup()).visible, { what: "the popup to close" });
        await obsidian.expectNoPopup();
    });

    test("icons show which provider a suggestion comes from (#46)", async () => {
        await wordList("e2e-icons.txt", ["iconlistword"]);
        scannedWords.push("iconscanword");
        await openFreshNote("Has iconscanword.\n<|>");
        await waitForScanned(obsidian, "iconscanword");

        await obsidian.type("iconl");
        await obsidian.waitForPopup((p) => p.items.includes("iconlistword"));
        // By default, words don't have icons
        expect((await renderedItems(obsidian)).every((i) => i.iconClass === null)).toBe(true);
        await obsidian.press("Escape");

        await obsidian.setSettings({ iconMode: IconMode.SUGGESTION_OR_PROVIDER });
        await obsidian.type(" icon");
        await obsidian.waitForPopup((p) => p.items.includes("iconlistword") && p.items.includes("iconscanword"));
        const items = await renderedItems(obsidian);
        expect(items.find((i) => i.text === "iconlistword")!.iconClass).toContain("lucide-book-open");
        expect(items.find((i) => i.text === "iconscanword")!.iconClass).toContain("lucide-file-search");

        await obsidian.press("Escape");
        await obsidian.setSettings({ iconMode: IconMode.NONE });
        await obsidian.type(" icon");
        await obsidian.waitForPopup((p) => p.items.includes("iconlistword"));
        expect((await renderedItems(obsidian)).every((i) => i.iconClass === null)).toBe(true);
    });
});
