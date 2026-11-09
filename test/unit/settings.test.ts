import { describe, expect, test } from "bun:test";
import {
    CalloutProviderSource,
    DEFAULT_SETTINGS,
    IconMode,
    loadSettings,
    SETTINGS_VERSION,
    SortOrder,
    WordInsertionMode,
} from "../../src/settings.ts";
import { DEFAULT_CHARACTER_REGEX, LEGACY_CHARACTER_REGEX } from "../../src/text.ts";

/** Settings as saved by v3.2.0 (no settingsVersion). */
const V3_DATA = {
    characterRegex: LEGACY_CHARACTER_REGEX,
    maxLookBackDistance: 50,
    autoFocus: true,
    autoTrigger: true,
    minWordLength: 2,
    minWordTriggerLength: 3,
    wordInsertionMode: "Ignore-Case & Replace",
    ignoreDiacriticsWhenFiltering: false,
    latexProviderEnabled: true,
    latexTriggerInCodeBlocks: true,
    latexMinWordTriggerLength: 2,
    latexIgnoreCase: false,
    fileScannerProviderEnabled: true,
    fileScannerScanCurrent: true,
    wordListProviderEnabled: true,
    frontMatterProviderEnabled: true,
    frontMatterTagAppendSuffix: true,
    frontMatterIgnoreCase: true,
    calloutProviderEnabled: true,
    calloutProviderSource: "Completr",
};

describe("DEFAULT_SETTINGS", () => {
    test("uses the current settings version and the unicode aware character class", () => {
        expect(DEFAULT_SETTINGS.settingsVersion).toBe(SETTINGS_VERSION);
        expect(DEFAULT_SETTINGS.characterRegex).toBe(DEFAULT_CHARACTER_REGEX);
    });
});

describe("loadSettings", () => {
    test("fresh install (no data) gives the defaults without migration", () => {
        expect(loadSettings(undefined)).toEqual({ settings: DEFAULT_SETTINGS, migratedFrom: null });
        expect(loadSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, migratedFrom: null });
    });

    test("returns a copy, not the defaults object", () => {
        const { settings } = loadSettings(undefined);
        expect(settings).not.toBe(DEFAULT_SETTINGS);
        settings.minWordLength = 99;
        expect(DEFAULT_SETTINGS.minWordLength).toBe(2);
        expect(loadSettings(undefined).settings.minWordLength).toBe(2);
    });

    test("current version data is used as is", () => {
        const data = {
            ...DEFAULT_SETTINGS,
            minWordLength: 5,
            fuzzyMatching: true,
            sortOrder: SortOrder.ALPHABETICAL,
            sortLocale: "sv",
            wordInsertionMode: WordInsertionMode.IGNORE_CASE_APPEND,
            iconMode: IconMode.NONE,
            calloutProviderSource: CalloutProviderSource.CALLOUT_MANAGER,
            characterRegex: LEGACY_CHARACTER_REGEX,
        };
        expect(loadSettings(data)).toEqual({ settings: data, migratedFrom: null });
    });

    test("missing keys are filled with defaults", () => {
        const { settings } = loadSettings({ settingsVersion: SETTINGS_VERSION, minWordLength: 4 });
        expect(settings).toEqual({ ...DEFAULT_SETTINGS, minWordLength: 4 });
    });

    test("values of the wrong type are ignored", () => {
        const { settings } = loadSettings({
            settingsVersion: SETTINGS_VERSION,
            minWordLength: "4",
            autoTrigger: "false",
            characterRegex: 42,
            sortLocale: null,
            fuzzyMatching: 1,
            rankByUsage: { value: false },
            sortOrder: ["longest"],
        });
        expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    test("falsy values of the right type are kept", () => {
        const { settings } = loadSettings({
            settingsVersion: SETTINGS_VERSION,
            minWordLength: 0,
            autoTrigger: false,
            sortLocale: "",
        });
        expect(settings.minWordLength).toBe(0);
        expect(settings.autoTrigger).toBe(false);
        expect(settings.sortLocale).toBe("");
    });

    test("unknown keys are dropped", () => {
        const { settings } = loadSettings({ settingsVersion: SETTINGS_VERSION, removedSetting: true, foo: "bar" });
        expect(settings).toEqual(DEFAULT_SETTINGS);
        expect("removedSetting" in settings).toBe(false);
    });

    test("does not modify the given data", () => {
        const data = { ...V3_DATA };
        loadSettings(data);
        expect(data).toEqual(V3_DATA);
    });

    describe("v1 (v3.x) -> v2 migration", () => {
        test("migrates the legacy character class to the unicode aware one", () => {
            const { settings, migratedFrom } = loadSettings(V3_DATA);
            expect(migratedFrom).toBe(1);
            expect(settings.characterRegex).toBe(DEFAULT_CHARACTER_REGEX);
            expect(settings.settingsVersion).toBe(SETTINGS_VERSION);
        });

        test("keeps all other v3 values", () => {
            const { settings } = loadSettings({ ...V3_DATA, minWordLength: 4, latexIgnoreCase: true });
            expect(settings.minWordLength).toBe(4);
            expect(settings.latexIgnoreCase).toBe(true);
            expect(settings.wordInsertionMode).toBe(WordInsertionMode.IGNORE_CASE_REPLACE);
            expect(settings.calloutProviderSource).toBe(CalloutProviderSource.COMPLETR);
        });

        test("new settings get their defaults", () => {
            const { settings } = loadSettings(V3_DATA);
            expect(settings.fuzzyMatching).toBe(DEFAULT_SETTINGS.fuzzyMatching);
            expect(settings.sortOrder).toBe(DEFAULT_SETTINGS.sortOrder);
            expect(settings.latexBuiltInCommands).toBe(DEFAULT_SETTINGS.latexBuiltInCommands);
        });

        test("a customized character class is kept", () => {
            const { settings, migratedFrom } = loadSettings({ ...V3_DATA, characterRegex: "a-zA-Z0-9" });
            expect(migratedFrom).toBe(1);
            expect(settings.characterRegex).toBe("a-zA-Z0-9");
        });

        test("v1 data without a character class gets the new default", () => {
            const { settings, migratedFrom } = loadSettings({ autoFocus: false });
            expect(migratedFrom).toBe(1);
            expect(settings.characterRegex).toBe(DEFAULT_CHARACTER_REGEX);
            expect(settings.autoFocus).toBe(false);
        });

        test("an empty data object is treated as v1", () => {
            expect(loadSettings({}).migratedFrom).toBe(1);
        });

        test("a non-number settingsVersion is treated as v1", () => {
            const { settings, migratedFrom } = loadSettings({ ...V3_DATA, settingsVersion: "2" });
            expect(migratedFrom).toBe(1);
            expect(settings.characterRegex).toBe(DEFAULT_CHARACTER_REGEX);
            expect(settings.settingsVersion).toBe(SETTINGS_VERSION);
        });
    });

    test("the legacy class chosen explicitly after the migration (v2) is kept", () => {
        const { settings, migratedFrom } = loadSettings({ settingsVersion: 2, characterRegex: LEGACY_CHARACTER_REGEX });
        expect(migratedFrom).toBeNull();
        expect(settings.characterRegex).toBe(LEGACY_CHARACTER_REGEX);
    });

    test("data from a newer version is not migrated", () => {
        const { settings, migratedFrom } = loadSettings({ settingsVersion: SETTINGS_VERSION + 1, minWordLength: 7 });
        expect(migratedFrom).toBeNull();
        expect(settings.minWordLength).toBe(7);
    });

    test("invalid enum values fall back to the default", () => {
        const { settings } = loadSettings({
            settingsVersion: SETTINGS_VERSION,
            sortOrder: "random",
            wordInsertionMode: "Something else",
            iconMode: "big",
            calloutProviderSource: "Elsewhere",
        });
        expect(settings).toEqual(DEFAULT_SETTINGS);
    });
});
