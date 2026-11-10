import { describe, expect, spyOn, test } from "bun:test";
import { SuggestionUsage } from "../../src/usage.ts";
import { flushPromises, makeDataFiles, pluginPath, useFakeTimers } from "./helpers.ts";

const FILE = pluginPath("suggestion_usage.json");

function setup(contents?: string) {
    const { files, adapter } = makeDataFiles();
    if (contents !== undefined) adapter.files.set(FILE, contents);
    return { usage: new SuggestionUsage(files), adapter };
}

const saved = (adapter: { files: Map<string, string> }) => JSON.parse(adapter.files.get(FILE) ?? "null") as unknown;

describe("SuggestionUsage", () => {
    const timers = useFakeTimers();

    test("unknown suggestions have a count of 0", () => {
        expect(setup().usage.get("x")).toBe(0);
    });

    test("record counts per display name", () => {
        const { usage } = setup();
        usage.record("a");
        usage.record("a");
        usage.record("b");
        expect(usage.get("a")).toBe(2);
        expect(usage.get("b")).toBe(1);
        expect(usage.get("A")).toBe(0);
    });

    test("record schedules a single delayed save", async () => {
        const { usage, adapter } = setup();
        usage.record("a");
        usage.record("b");
        expect(timers.delays).toEqual([5000]);
        expect(adapter.writes).toHaveLength(0);

        timers.runAll();
        await flushPromises();
        expect(saved(adapter)).toEqual({ a: 1, b: 1 });

        // A new record after the save schedules a new one
        usage.record("a");
        expect(timers.pending.size).toBe(1);
    });

    test("flush writes immediately and cancels the timer", async () => {
        const { usage, adapter } = setup();
        usage.record("a");
        await usage.flush();
        expect(timers.pending.size).toBe(0);
        expect(saved(adapter)).toEqual({ a: 1 });
    });

    test("flush without changes does not write", async () => {
        const { usage, adapter } = setup();
        await usage.flush();
        usage.record("a");
        await usage.flush();
        await usage.flush();
        expect(adapter.writes).toHaveLength(1);
    });

    test("load reads the counts", async () => {
        const { usage, adapter } = setup(JSON.stringify({ "\\alpha": 3, word: 1 }));
        await usage.load();
        expect(usage.get("\\alpha")).toBe(3);
        expect(usage.get("word")).toBe(1);
        expect(adapter.writes).toHaveLength(0);
    });

    test("load ignores non-number values", async () => {
        const { usage } = setup(JSON.stringify({ a: 2, b: "3", c: null, d: [1] }));
        await usage.load();
        expect(usage.get("a")).toBe(2);
        expect(usage.get("b")).toBe(0);
        expect(usage.get("c")).toBe(0);
        expect(usage.get("d")).toBe(0);
    });

    test("load without a file or with an empty file keeps the counts empty", async () => {
        const missing = setup();
        await missing.usage.load();
        expect(missing.usage.get("a")).toBe(0);

        const empty = setup("");
        await empty.usage.load();
        expect(empty.usage.get("a")).toBe(0);
    });

    test("invalid JSON is reported and ignored", async () => {
        const { usage } = setup("{not json");
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            await usage.load();
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
        expect(usage.get("not json")).toBe(0);
    });

    test("a JSON null is reported and ignored instead of crashing", async () => {
        const { usage } = setup("null");
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            await usage.load();
        } finally {
            warn.mockRestore();
        }
        expect(usage.get("a")).toBe(0);
    });

    test("counts continue from the loaded values", async () => {
        const { usage, adapter } = setup(JSON.stringify({ a: 5 }));
        await usage.load();
        usage.record("a");
        await usage.flush();
        expect(saved(adapter)).toEqual({ a: 6 });
    });

    test("size is the number of known suggestions", async () => {
        const { usage } = setup(JSON.stringify({ a: 5, b: 1 }));
        expect(usage.size).toBe(0);
        await usage.load();
        expect(usage.size).toBe(2);
        usage.record("a");
        expect(usage.size).toBe(2);
        usage.record("c");
        expect(usage.size).toBe(3);
    });

    test("clear resets all counts and has saved once it resolves", async () => {
        const { usage, adapter } = setup(JSON.stringify({ a: 5 }));
        await usage.load();
        await usage.clear();
        expect(usage.get("a")).toBe(0);
        expect(usage.size).toBe(0);
        expect(saved(adapter)).toEqual({});
        expect(adapter.writes).toHaveLength(1);
    });

    test("clear cancels a pending save instead of saving twice", async () => {
        const { usage, adapter } = setup();
        usage.record("a");
        await usage.clear();
        expect(timers.pending.size).toBe(0);
        expect(adapter.writes).toEqual([[FILE, "{}"]]);
    });

    test("counting continues after clear", async () => {
        const { usage, adapter } = setup(JSON.stringify({ a: 5 }));
        await usage.load();
        await usage.clear();
        usage.record("a");
        expect(usage.get("a")).toBe(1);
        await usage.flush();
        expect(saved(adapter)).toEqual({ a: 1 });
    });

    test("a failed save rejects flush and is retried by the next one", async () => {
        const { usage, adapter } = setup();
        usage.record("a");
        adapter.failingWrites.add(FILE);
        await expect(usage.flush()).rejects.toThrow("ENOSPC");
        expect(adapter.files.has(FILE)).toBe(false);

        adapter.failingWrites.clear();
        await usage.flush();
        expect(saved(adapter)).toEqual({ a: 1 });
    });

    test("clear rejects if the counts can't be saved", async () => {
        const { usage, adapter } = setup(JSON.stringify({ a: 5 }));
        await usage.load();
        adapter.failingWrites.add(FILE);
        await expect(usage.clear()).rejects.toThrow("ENOSPC");
        expect(usage.size).toBe(0);
    });

    test("only the 5000 most used entries are saved", async () => {
        const counts: Record<string, number> = {};
        for (let i = 0; i < 5100; i++) counts["w" + i] = i;
        const { usage, adapter } = setup(JSON.stringify(counts));
        await usage.load();
        usage.record("w0"); // count 1, among the least used
        await usage.flush();

        const result = saved(adapter) as Record<string, number>;
        expect(Object.keys(result)).toHaveLength(5000);
        expect(result.w5099).toBe(5099);
        expect(result.w100).toBe(100);
        expect(result.w99).toBeUndefined();
        expect(result.w0).toBeUndefined();
        // The in-memory counts are trimmed as well
        expect(usage.get("w0")).toBe(0);
        expect(usage.get("w5099")).toBe(5099);
    });
});
