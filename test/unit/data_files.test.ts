import { describe, expect, spyOn, test } from "bun:test";
import { DebouncedSaver, decodeText, splitLines } from "../../src/data_files.ts";
import { flushPromises, makeDataFiles, PLUGIN_FOLDER, pluginPath, useFakeTimers } from "./helpers.ts";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const utf8 = (text: string) => new TextEncoder().encode(text);

function utf16(text: string, bigEndian: boolean, bom = true): ArrayBuffer {
    const out = new Uint8Array((text.length + (bom ? 1 : 0)) * 2);
    const view = new DataView(out.buffer);
    let offset = 0;
    if (bom) {
        view.setUint16(0, 0xfeff, !bigEndian);
        offset = 2;
    }
    for (let i = 0; i < text.length; i++) view.setUint16(offset + i * 2, text.charCodeAt(i), !bigEndian);
    return out.buffer;
}

describe("decodeText", () => {
    const sample = "Grüße\nκόσμος\nकिताब\n𠀀😀";

    test("UTF-8 without BOM", () => {
        expect(decodeText(utf8(sample).buffer)).toBe(sample);
    });

    test("UTF-8 with BOM, the BOM is removed", () => {
        const encoded = utf8(sample);
        const withBom = new Uint8Array(encoded.length + 3);
        withBom.set([0xef, 0xbb, 0xbf]);
        withBom.set(encoded, 3);
        expect(decodeText(withBom.buffer)).toBe(sample);
    });

    test("UTF-16 LE with BOM", () => {
        expect(decodeText(utf16(sample, false))).toBe(sample);
    });

    test("UTF-16 BE with BOM", () => {
        expect(decodeText(utf16(sample, true))).toBe(sample);
    });

    test("invalid UTF-8 falls back to Windows-1252", () => {
        // "Grüße" in Latin-1 / Windows-1252
        expect(decodeText(bytes(0x47, 0x72, 0xfc, 0xdf, 0x65))).toBe("Grüße");
        // 0x80 is the euro sign in Windows-1252 (in Latin-1 it would be a control character)
        expect(decodeText(bytes(0x80, 0x20, 0x35))).toBe("€ 5");
        expect(decodeText(bytes(0x93, 0x71, 0x94))).toBe("“q”");
    });

    test("pure ASCII", () => {
        expect(decodeText(bytes(0x61, 0x0a, 0x62))).toBe("a\nb");
    });

    test("empty buffer", () => {
        expect(decodeText(new ArrayBuffer(0))).toBe("");
    });

    test("BOM only", () => {
        expect(decodeText(bytes(0xef, 0xbb, 0xbf))).toBe("");
        expect(decodeText(bytes(0xff, 0xfe))).toBe("");
    });

    test("a partial UTF-8 BOM is not a BOM", () => {
        // 0xEF 0xBB alone is invalid UTF-8 -> Windows-1252
        expect(decodeText(bytes(0xef, 0xbb, 0x41))).toBe("ï»A");
    });
});

describe("splitLines", () => {
    test("splits on LF and CRLF", () => {
        expect(splitLines("a\nb\r\nc")).toEqual(["a", "b", "c"]);
    });

    test("keeps empty lines and the empty line after a trailing newline", () => {
        expect(splitLines("a\n\nb\n")).toEqual(["a", "", "b", ""]);
    });

    test("a lone CR is not a line break", () => {
        expect(splitLines("a\rb")).toEqual(["a\rb"]);
    });

    test("empty text is one empty line", () => {
        expect(splitLines("")).toEqual([""]);
    });
});

describe("DataFiles", () => {
    test("path joins segments below the plugin folder", () => {
        const { files } = makeDataFiles();
        expect(files.folder).toBe(PLUGIN_FOLDER);
        expect(files.path("a.txt")).toBe(PLUGIN_FOLDER + "/a.txt");
        expect(files.path("wordLists", "en.txt")).toBe(PLUGIN_FOLDER + "/wordLists/en.txt");
        expect(files.path()).toBe(PLUGIN_FOLDER);
    });

    test("read returns null for missing files", async () => {
        const { files } = makeDataFiles();
        expect(await files.read("missing.txt")).toBeNull();
    });

    test("write then read and exists", async () => {
        const { files, adapter } = makeDataFiles();
        expect(await files.exists("a.txt")).toBe(false);
        await files.write("a.txt", "content");
        expect(adapter.files.get(pluginPath("a.txt"))).toBe("content");
        expect(await files.exists("a.txt")).toBe(true);
        expect(await files.read("a.txt")).toBe("content");
    });

    test("read of an empty file returns an empty string, not null", async () => {
        const { files } = makeDataFiles();
        await files.write("empty.txt", "");
        expect(await files.read("empty.txt")).toBe("");
    });

    test("remove deletes existing files and ignores missing ones", async () => {
        const { files, adapter } = makeDataFiles();
        await files.write("a.txt", "x");
        await files.remove("a.txt");
        expect(adapter.files.has(pluginPath("a.txt"))).toBe(false);
        await files.remove("a.txt"); // does not throw
    });

    test("list creates a missing folder", async () => {
        const { files, adapter } = makeDataFiles();
        expect(await files.list("wordLists")).toEqual([]);
        expect(adapter.folders.has(pluginPath("wordLists"))).toBe(true);
    });

    test("list returns names relative to the plugin folder", async () => {
        const { files } = makeDataFiles();
        await files.write("wordLists/b.txt", "b");
        await files.write("wordLists/a.txt", "a");
        await files.write("other.txt", "o");
        expect(await files.list("wordLists")).toEqual(["wordLists/a.txt", "wordLists/b.txt"]);
    });

    test("listed names can be passed to the other methods", async () => {
        const { files, adapter } = makeDataFiles();
        await files.write("wordLists/a.txt", "content");
        const [name] = await files.list("wordLists");
        expect(await files.exists(name)).toBe(true);
        expect(await files.read(name)).toBe("content");
        await files.remove(name);
        expect(adapter.files.has(pluginPath("wordLists/a.txt"))).toBe(false);
    });

    test("list does not include sub folders or their files", async () => {
        const { files, adapter } = makeDataFiles();
        await files.write("wordLists/a.txt", "a");
        adapter.folders.add(pluginPath("wordLists/sub"));
        await files.write("wordLists/sub/b.txt", "b");
        expect(await files.list("wordLists")).toEqual(["wordLists/a.txt"]);
    });
});

describe("DebouncedSaver", () => {
    const timers = useFakeTimers();

    /** A saver whose save function counts its calls and fails while `fail` is set. */
    function setup(delay = 1000) {
        const state = { saves: 0, fail: false };
        const saver = new DebouncedSaver(() => {
            state.saves++;
            return state.fail ? Promise.reject(new Error("disk full")) : Promise.resolve();
        }, delay);
        return { saver, state };
    }

    test("nothing is saved or scheduled before the first change", () => {
        const { state } = setup();
        expect(timers.pending.size).toBe(0);
        expect(state.saves).toBe(0);
    });

    test("several schedule() calls lead to a single save after the delay", async () => {
        const { saver, state } = setup();
        saver.schedule();
        saver.schedule();
        saver.schedule();
        expect(timers.pending.size).toBe(1);
        expect(state.saves).toBe(0);

        timers.runAll();
        await flushPromises();
        expect(state.saves).toBe(1);
        expect(timers.pending.size).toBe(0);
    });

    test.each([1, 2000, 5000])("the timer uses the given delay of %p ms", (delay) => {
        const { saver } = setup(delay);
        saver.schedule();
        expect(timers.delays).toEqual([delay]);
    });

    test("a change after the delayed save schedules a new one", async () => {
        const { saver, state } = setup();
        saver.schedule();
        timers.runAll();
        await flushPromises();

        saver.schedule();
        expect(timers.pending.size).toBe(1);
        timers.runAll();
        await flushPromises();
        expect(state.saves).toBe(2);
    });

    test("flush() without changes does nothing", async () => {
        const { saver, state } = setup();
        await saver.flush();
        expect(state.saves).toBe(0);

        saver.schedule();
        await saver.flush();
        await saver.flush();
        expect(state.saves).toBe(1);
    });

    test("flush() saves right away and cancels the timer", async () => {
        const { saver, state } = setup();
        saver.schedule();
        await saver.flush();
        expect(state.saves).toBe(1);
        expect(timers.pending.size).toBe(0);
    });

    test("flush() resolves only after the save is done", async () => {
        let finish = () => {};
        let done = false;
        const saver = new DebouncedSaver(() => new Promise<void>((resolve) => (finish = resolve)), 1000);
        saver.schedule();
        const flushed = saver.flush().then(() => (done = true));
        await flushPromises();
        expect(done).toBe(false);
        finish();
        await flushed;
        expect(done).toBe(true);
    });

    test("a failing save rejects flush() and is retried by the next flush()", async () => {
        const { saver, state } = setup();
        state.fail = true;
        saver.schedule();
        await expect(saver.flush()).rejects.toThrow("disk full");
        expect(state.saves).toBe(1);

        state.fail = false;
        await saver.flush();
        expect(state.saves).toBe(2);
        // Saved now, nothing left to retry
        await saver.flush();
        expect(state.saves).toBe(2);
    });

    test("a failing delayed save is logged and retried by the next flush()", async () => {
        const { saver, state } = setup();
        const error = spyOn(console, "error").mockImplementation(() => {});
        try {
            state.fail = true;
            saver.schedule();
            timers.runAll();
            await flushPromises();
            expect(state.saves).toBe(1);
            expect(error).toHaveBeenCalledTimes(1);
        } finally {
            error.mockRestore();
        }

        state.fail = false;
        await saver.flush();
        expect(state.saves).toBe(2);
    });

    test("a failing save is retried by the next scheduled save as well", async () => {
        const { saver, state } = setup();
        state.fail = true;
        saver.schedule();
        await expect(saver.flush()).rejects.toThrow("disk full");
        expect(timers.pending.size).toBe(0);

        state.fail = false;
        saver.schedule();
        timers.runAll();
        await flushPromises();
        expect(state.saves).toBe(2);
    });

    test("a change made while a save is running is saved afterwards", async () => {
        let finish = () => {};
        let saves = 0;
        const saver = new DebouncedSaver(() => {
            saves++;
            return new Promise<void>((resolve) => (finish = resolve));
        }, 1000);
        saver.schedule();
        const first = saver.flush();
        saver.schedule();
        finish();
        await first;
        expect(saves).toBe(1);
        expect(timers.pending.size).toBe(1);

        const second = saver.flush();
        finish();
        await second;
        expect(saves).toBe(2);
    });
});
