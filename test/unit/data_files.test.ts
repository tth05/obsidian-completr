import { describe, expect, test } from "bun:test";
import { decodeText, splitLines } from "../../src/data_files.ts";
import { makeDataFiles, PLUGIN_FOLDER, pluginPath } from "./helpers.ts";

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

    test("list creates a missing folder and returns vault relative paths", async () => {
        const { files, adapter } = makeDataFiles();
        expect(await files.list("wordLists")).toEqual([]);
        expect(adapter.folders.has(pluginPath("wordLists"))).toBe(true);

        await files.write("wordLists/b.txt", "b");
        await files.write("wordLists/a.txt", "a");
        await files.write("other.txt", "o");
        expect(await files.list("wordLists")).toEqual([pluginPath("wordLists/a.txt"), pluginPath("wordLists/b.txt")]);
    });

    test("readPath and removePath take vault relative paths", async () => {
        const { files, adapter } = makeDataFiles();
        adapter.files.set("somewhere/else.txt", "data");
        expect(await files.readPath("somewhere/else.txt")).toBe("data");
        await files.removePath("somewhere/else.txt");
        expect(adapter.files.has("somewhere/else.txt")).toBe(false);
    });
});
