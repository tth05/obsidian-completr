import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getBuiltInLatexCommands, type LatexCommand } from "../../src/provider/latex_provider.ts";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import {
    expectLatexSuggestions,
    expectNoLatexSuggestions,
    openFreshNote,
    selectAndInsert,
    waitForLatexPopup,
} from "./helpers/latex.ts";

const PLUGIN_PATH = ".obsidian/plugins/obsidian-completr";
const COMMANDS_FILE = `${PLUGIN_PATH}/latex_commands.json`;

let obsidian: Obsidian;
beforeAll(async () => {
    obsidian = await getObsidian();
});
beforeEach(async () => {
    // Usage ranking would make the order depend on the suggestions inserted by earlier tests.
    await obsidian.resetSettings();
    await obsidian.setSettings({ rankByUsage: false });
});

/** Types `typed`, inserts the popup item `item` and returns the editor text with the cursor. */
async function complete(content: string, typed: string, item: string) {
    await openFreshNote(obsidian, content);
    await obsidian.type(typed);
    await selectAndInsert(obsidian, item);
    return (await obsidian.editor()).textWithCursor;
}

describe("suggestions are shown in math", () => {
    test("unclosed inline math", () => expectLatexSuggestions(obsidian, "Some text <|>", "$\\fr"));
    test("closed inline math, in front of the closing $", () => expectLatexSuggestions(obsidian, "Some $<|>$ text"));
    test("math block", () => expectLatexSuggestions(obsidian, "$$\n<|>\n$$"));
    test("unclosed math block", () => expectLatexSuggestions(obsidian, "Text\n\n$$\n<|>"));
    test("single line math block", () => expectLatexSuggestions(obsidian, "$$<|>$$"));
    test("math block in a callout", () => expectLatexSuggestions(obsidian, "> [!note]\n> $$\n> <|>\n> $$"));
    test("inline math in a block quote", () => expectLatexSuggestions(obsidian, "> quote $<|>$"));
    test("inline math in a list item", () => expectLatexSuggestions(obsidian, "- item $<|>$"));
    test("math block in a list item", () => expectLatexSuggestions(obsidian, "- item\n  $$\n  <|>\n  $$"));
    test("after a closed inline math on the same line", async () => {
        await expectLatexSuggestions(obsidian, "$x$ and $<|>$");
        await expectLatexSuggestions(obsidian, "$x$ and <|>", "$\\fr");
    });
    test("inside code after a dollar sign (latexTriggerInCodeBlocks, the default)", async () => {
        await expectLatexSuggestions(obsidian, "```\n<|>\n```", "$\\fr");
        await expectLatexSuggestions(obsidian, "Text `<|>`", "$\\fr");
    });
});

describe("no suggestions outside of math", () => {
    test("plain text", () => expectNoLatexSuggestions(obsidian, "Plain text <|>"));
    test("after a closed inline math", () => expectNoLatexSuggestions(obsidian, "$x$ and <|>"));
    test("after an escaped dollar sign", () => expectNoLatexSuggestions(obsidian, "It costs \\$5 <|>"));
    test("escaped dollar sign does not open math", () => expectNoLatexSuggestions(obsidian, "Text <|>", "\\$\\fr"));
    test("after a closed math block", () => expectNoLatexSuggestions(obsidian, "$$\nx\n$$\n<|>"));
    test("code block without a dollar sign", () => expectNoLatexSuggestions(obsidian, "```\n<|>\n```"));
    test("inline code without a dollar sign", () => expectNoLatexSuggestions(obsidian, "Text `<|>`"));
    test("code with latexTriggerInCodeBlocks disabled", async () => {
        await obsidian.setSettings({ latexTriggerInCodeBlocks: false });
        await expectNoLatexSuggestions(obsidian, "```\n<|>\n```", "$\\fr");
        await expectNoLatexSuggestions(obsidian, "Text `<|>`", "$\\fr");
        // Math outside of code still works
        await expectLatexSuggestions(obsidian, "`code` $<|>$");
    });
    test("disabled LaTeX provider", async () => {
        await obsidian.setSettings({ latexProviderEnabled: false });
        await expectNoLatexSuggestions(obsidian, "$<|>$");
    });
});

describe("ranking and matching", () => {
    test("exact command ranks before longer ones containing the query", async () => {
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\vee");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("\\curlyvee"));
        expect(popup.items[0]).toBe("\\vee");
        expect(popup.items.indexOf("\\vee")).toBeLessThan(popup.items.indexOf("\\curlyvee"));
        // Prefix matches before matches in the middle
        expect(popup.items.indexOf("\\veebar")).toBeLessThan(popup.items.indexOf("\\bigvee"));
    });

    test("query without a backslash", async () => {
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("vee");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("\\vee"));
        expect(popup.items[0]).toBe("\\vee");
    });

    test("latexMinWordTriggerLength", async () => {
        await obsidian.setSettings({ latexMinWordTriggerLength: 4 });
        await expectNoLatexSuggestions(obsidian, "$<|>$", "\\fra");
        await obsidian.type("c");
        await waitForLatexPopup(obsidian);
    });

    test("case sensitivity (latexIgnoreCase)", async () => {
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\Gam");
        let popup = await obsidian.waitForPopup((p) => p.items.includes("\\Gamma"));
        expect(popup.items).not.toContain("\\gamma");

        await obsidian.setSettings({ latexIgnoreCase: true });
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\Gam");
        popup = await obsidian.waitForPopup((p) => p.items.includes("\\gamma"));
        expect(popup.items).toContain("\\Gamma");
    });

    // Shift+D used to be the default hotkey of "blacklist the selected suggestion", which swallowed capital D's.
    test("uppercase D can be typed (\\Delta)", async () => {
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\Del");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("\\Delta"));
        expect(popup.items).not.toContain("\\delta");
        expect((await obsidian.editor()).textWithCursor).toBe("$\\Del<|>$");
    });
});

describe("insertion", () => {
    test("typed backslash is not doubled", async () => {
        expect(await complete("$<|>$", "\\fr", "\\frac{#}{#}")).toBe("$\\frac{<|>}{}$");
    });

    test("missing backslash is inserted", async () => {
        expect(await complete("$<|>$", "fr", "\\frac{#}{#}")).toBe("$\\frac{<|>}{}$");
    });

    test("command without placeholders puts the cursor at the end", async () => {
        expect(await complete("$x <|>$", "\\alp", "\\alpha")).toBe("$x \\alpha<|>$");
    });

    test("issue #76: \\sum has the subscript before the superscript", async () => {
        expect(await complete("$<|>$", "\\sum", "\\sum_{#}^{#}")).toBe("$\\sum_{<|>}^{}$");
    });

    test("issue #82: commands are inserted in math blocks", async () => {
        expect(await complete("$$\n<|>\n$$", "\\fr", "\\frac{#}{#}")).toBe("$$\n\\frac{<|>}{}\n$$");
    });

    test("environments in inline math are inserted without newlines", async () => {
        expect(await complete("$<|>$", "\\begin", "\\begin{align}...")).toBe("$\\begin{align}<|>\\end{align}$");
    });

    test("environments in math blocks span multiple lines", async () => {
        expect(await complete("$$\n<|>\n$$", "\\begin", "\\begin{align}...")).toBe(
            "$$\n\\begin{align}\n<|>\n\\end{align}\n$$",
        );
    });

    test("environments in callouts keep the quote markers", async () => {
        expect(await complete("> [!note]\n> $$\n> <|>\n> $$", "\\begin", "\\begin{align}...")).toBe(
            "> [!note]\n> $$\n> \\begin{align}\n> <|>\n> \\end{align}\n> $$",
        );
    });

    test("environments in list items keep the indentation", async () => {
        expect(await complete("- item\n  $$\n  <|>\n  $$", "\\begin", "\\begin{align}...")).toBe(
            "- item\n  $$\n  \\begin{align}\n  <|>\n  \\end{align}\n  $$",
        );
    });

    test("environment with a parameter", async () => {
        expect(await complete("$$\n<|>\n$$", "\\begin", "\\begin{array}...")).toBe(
            "$$\n\\begin{array}{<|>}\n\\end{array}\n$$",
        );
    });
});

describe("custom commands", () => {
    afterEach(async () => {
        await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.latex.setCustomCommands([]));
    });

    test("are loaded from latex_commands.json and rank among the built-in ones", async () => {
        await obsidian.writeVaultFile(
            COMMANDS_FILE,
            JSON.stringify(["\\frbox{#}", { displayName: "\\myvec", replacement: "\\vec{#}" }]),
        );
        await obsidian.reloadPlugin();

        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\fr");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("\\frbox{#}"));
        // Sorted by name length ("\frbox" and "\frown" tie, custom commands come first)
        expect(popup.items.slice(0, 4)).toEqual(["\\frac{#}{#}", "\\frak", "\\frbox{#}", "\\frown"]);

        expect(await complete("$<|>$", "\\myv", "\\myvec")).toBe("$\\vec{<|>}$");
    });

    test("latexBuiltInCommands=false only shows custom commands", async () => {
        await obsidian.writeVaultFile(COMMANDS_FILE, JSON.stringify(["\\frbox{#}"]));
        await obsidian.reloadPlugin();
        await obsidian.setSettings({ latexBuiltInCommands: false });

        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\fr");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("\\frbox{#}"));
        expect(popup.items.filter((i) => i.startsWith("\\"))).toEqual(["\\frbox{#}"]);
    });

    test("invalid JSON shows a notice and keeps the built-in commands working", async () => {
        await obsidian.eval(() => document.querySelectorAll(".notice").forEach((n) => n.remove()));
        await obsidian.writeVaultFile(COMMANDS_FILE, '["\\\\broken{#}",');
        await obsidian.reloadPlugin();

        const notice = await obsidian.waitFor(() =>
            obsidian.eval(() =>
                Array.from(document.querySelectorAll(".notice"))
                    .map((n) => n.textContent ?? "")
                    .find((t) => t.includes("latex_commands.json")),
            ),
        );
        expect(notice).toContain("Failed to load latex_commands.json");
        await obsidian.eval(() => document.querySelectorAll(".notice").forEach((n) => n.remove()));
        // The broken file is left alone, so the user can fix it
        expect(await obsidian.readVaultFile(COMMANDS_FILE)).toBe('["\\\\broken{#}",');

        await expectLatexSuggestions(obsidian, "$<|>$");

        // Saving new commands backs up the broken file first
        await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.latex.setCustomCommands([]));
        const backup = `${COMMANDS_FILE}.broken.bak`;
        expect(await obsidian.readVaultFile(backup)).toBe('["\\\\broken{#}",');
        await obsidian.eval((p: string) => app.vault.adapter.remove(p), backup);
    });

    test("are saved to latex_commands.json when changed through the API", async () => {
        const commands: LatexCommand[] = [
            { displayName: "\\apicmd", replacement: "\\apicmd" },
            { displayName: "\\apifrac", replacement: "\\frac{#}{#}" },
        ];
        await obsidian.eval(
            (commands: LatexCommand[]) => app.plugins.plugins["obsidian-completr"]!.latex.setCustomCommands(commands),
            commands,
        );

        const file = await obsidian.readVaultFile(COMMANDS_FILE);
        // Commands without a separate replacement are stored as plain strings
        expect(JSON.parse(file!)).toEqual(["\\apicmd", { displayName: "\\apifrac", replacement: "\\frac{#}{#}" }]);

        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\api");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("\\apifrac"));
        expect(popup.items.slice(0, 2)).toEqual(["\\apicmd", "\\apifrac"]);
    });
});

test("v3 settings and latex_commands.json are migrated", async () => {
    const DATA_FILE = `${PLUGIN_PATH}/data.json`;
    const BLACKLIST_FILE = `${PLUGIN_PATH}/blacklisted_suggestions.txt`;
    const BACKUP_FILE = `${COMMANDS_FILE}.v3.bak`;
    const originals = await Promise.all(
        [DATA_FILE, BLACKLIST_FILE, COMMANDS_FILE].map((f) => obsidian.readVaultFile(f)),
    );

    // v3 shipped all default commands in the file, with "\sum^{#}_{#}" instead of "\sum_{#}^{#}" (#76)
    const deleted = "\\veebar";
    const custom = { displayName: "\\mycustom", replacement: "\\mycustom{#}" };
    const v3Commands: (string | LatexCommand)[] = getBuiltInLatexCommands()
        .filter((c) => c.displayName !== deleted)
        .map((c) => {
            const name = c.displayName.replace(/^\\(sum|int|prod)_\{#\}\^\{#\}$/, "\\$1^{#}_{#}");
            return c.displayName === c.replacement ? name : c;
        });
    v3Commands.splice(10, 0, custom);
    const v3File = JSON.stringify(v3Commands, null, 2);

    try {
        await obsidian.writeVaultFile(DATA_FILE, JSON.stringify({ characterRegex: "a-zA-ZöäüÖÄÜß" }));
        await obsidian.writeVaultFile(COMMANDS_FILE, v3File);
        await obsidian.reloadPlugin();

        expect(JSON.parse((await obsidian.readVaultFile(COMMANDS_FILE))!)).toEqual([custom]);
        expect(await obsidian.readVaultFile(BACKUP_FILE)).toBe(v3File);

        const state = await obsidian.eval(() => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            return {
                blacklist: plugin.blacklist.values(),
                characterRegex: plugin.settings.characterRegex,
                settingsVersion: plugin.settings.settingsVersion,
            };
        });
        // Only the deleted default is blacklisted, not the renamed "\sum_{#}^{#}" etc.
        expect(state.blacklist).toEqual([deleted]);
        expect(state.characterRegex).toBe("\\p{L}\\p{M}");
        const saved = JSON.parse((await obsidian.readVaultFile(DATA_FILE))!) as Record<string, unknown>;
        expect(saved.characterRegex).toBe("\\p{L}\\p{M}");
        expect(saved.settingsVersion).toBe(state.settingsVersion);
        expect((await obsidian.readVaultFile(BLACKLIST_FILE))?.split("\n")).toEqual([deleted]);

        // The migrated commands work
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\vee");
        let popup = await obsidian.waitForPopup((p) => p.items.includes("\\vee"));
        expect(popup.items).not.toContain(deleted);
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\myc");
        popup = await obsidian.waitForPopup((p) => p.items.includes("\\mycustom"));

        // A second load doesn't migrate again
        await obsidian.reloadPlugin();
        expect(JSON.parse((await obsidian.readVaultFile(COMMANDS_FILE))!)).toEqual([custom]);
    } finally {
        const files = [DATA_FILE, BLACKLIST_FILE, COMMANDS_FILE];
        for (let i = 0; i < files.length; i++) {
            const original = originals[i];
            if (original !== null && original !== undefined) await obsidian.writeVaultFile(files[i], original);
            else await obsidian.eval((p: string) => app.vault.adapter.remove(p), files[i]);
        }
        await obsidian.eval(async (p: string) => {
            if (await app.vault.adapter.exists(p)) await app.vault.adapter.remove(p);
        }, BACKUP_FILE);
        await obsidian.reloadPlugin();
    }
});

describe("previews in the popup", () => {
    /** For each popup item: its text and whether it shows a rendered MathJax preview. */
    function previews() {
        return obsidian.eval(() =>
            Array.from(document.querySelectorAll(".completr-suggestion-item"), (item) => ({
                text: item.querySelector(".completr-suggestion-text")?.textContent ?? "",
                hasPreviewEl: !!item.querySelector(".completr-suggestion-preview"),
                rendered: !!item.querySelector(".completr-suggestion-preview mjx-container"),
            })),
        );
    }

    async function waitForPreview(item: string) {
        await obsidian.waitFor(async () => (await previews()).find((i) => i.text === item)?.rendered, {
            what: `the preview of ${item}`,
        });
    }

    test("commands are rendered with MathJax", async () => {
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\alp");
        await obsidian.waitForPopup((p) => p.items.includes("\\alpha"));
        await waitForPreview("\\alpha");
    });

    test("commands with placeholders are rendered", async () => {
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\frac");
        await waitForLatexPopup(obsidian);
        await waitForPreview("\\frac{#}{#}");
    });

    test("environments have no preview", async () => {
        await openFreshNote(obsidian, "$$\n<|>\n$$");
        await obsidian.type("\\begin");
        await obsidian.waitForPopup((p) => p.items.includes("\\begin{align}..."));
        await Bun.sleep(150);
        const environments = (await previews()).filter((i) => i.text.startsWith("\\begin{"));
        expect(environments.length).toBeGreaterThan(0);
        expect(environments.filter((i) => i.rendered)).toEqual([]);
    });

    test("latexPreview=false disables them", async () => {
        await obsidian.setSettings({ latexPreview: false });
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\alp");
        await obsidian.waitForPopup((p) => p.items.includes("\\alpha"));
        await Bun.sleep(150);
        expect((await previews()).filter((i) => i.hasPreviewEl)).toEqual([]);
    });
});
