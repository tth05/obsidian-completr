import {MarkerRange, TextMarker} from "codemirror";
import {Editor, EditorPosition} from "obsidian";
import * as CodeMirror from "codemirror";

const COLORS = ["lightskyblue", "orange", "lime", "pink", "cornsilk", "magenta", "navajowhite"];

export type SnippetPlaceholder = {
    marker: TextMarker,
    editor: Editor
}

export default class SnippetManager {
    private currentPlaceholders: SnippetPlaceholder[] = [];

    handleSnippet(value: string, start: EditorPosition, editor: Editor) {
        const color = COLORS.filter(color => !this.currentPlaceholders.find(p => p.marker.css.endsWith(color))).first() ??
            COLORS[Math.floor(Math.random() * COLORS.length)];

        const lines = value.split("\n");

        for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex--) {
            const line = lines[lineIndex];

            for (let i = line.length - 1; i >= 0; i--) {
                const c = line.charAt(i);

                if (c !== "#" && c !== "~")
                    continue;

                const lineBaseOffset = lineIndex === 0 ? start.ch : 0;
                if (c === "~") {
                    //Hack: Will break things if a # is on the same line
                    const cursorPos = {line: start.line + lineIndex, ch: lineBaseOffset + i};
                    editor.setCursor(cursorPos);
                    editor.replaceRange("", cursorPos, {...cursorPos, ch: cursorPos.ch + 1});
                    continue;
                }

                const placeholder = {
                    marker: (
                        // @ts-ignore
                        editor.cm as unknown as CodeMirror.Doc
                    ).markText(
                        {line: start.line + lineIndex, ch: lineBaseOffset + i},
                        {line: start.line + lineIndex, ch: lineBaseOffset + i + 1},
                        {
                            inclusiveLeft: true,
                            inclusiveRight: true,
                            clearWhenEmpty: false,
                            className: "completr-suggestion-placeholder",
                            css: "border-color:" + color
                        }
                    ),
                    editor: editor
                };

                placeholder.marker.on("clear", () => {
                    this.currentPlaceholders.remove(placeholder);
                });
                placeholder.marker.on("hide", () => {
                    this.clearAllPlaceholders();
                });

                this.currentPlaceholders.unshift(placeholder);
            }
        }

        this.selectMarker(this.currentPlaceholders[0]);
    }

    consumeAndGotoNextMarker(editor: Editor): boolean {
        this.clearInvalidPlaceholders();
        //Remove the placeholder that we're inside of
        const oldPlaceholder = this.currentPlaceholders.shift();
        const oldRange = SnippetManager.rangeFromPlaceholder(oldPlaceholder);
        oldPlaceholder.marker.clear();

        //If there's none left, return
        if (this.currentPlaceholders.length === 0)
            return false;

        const placeholder = this.currentPlaceholders[0];

        const newRange = SnippetManager.rangeFromPlaceholder(placeholder);
        if (newRange.from.ch <= oldRange.from.ch && newRange.to.ch >= oldRange.to.ch) {
            //If the old placeholder is inside of the next one, we just move the cursor
            editor.setCursor({...newRange.to});
        } else {
            this.selectMarker(placeholder);
        }

        return true;
    }

    placeholderAtPos(editor: Editor, pos: EditorPosition): SnippetPlaceholder {
        this.clearInvalidPlaceholders();

        for (const placeholder of this.currentPlaceholders) {
            const range = SnippetManager.rangeFromPlaceholder(placeholder);
            //Return the first one that matches, because it should be the one where we're at
            if (range.from.ch <= pos.ch && range.to.ch >= pos.ch)
                return placeholder;
        }

        return null;
    }

    selectMarker(placeholder: SnippetPlaceholder) {
        if (!placeholder)
            return;

        const range = placeholder.marker.find() as MarkerRange;

        const from = {...range.from, ch: range.from.ch};
        placeholder.editor.setSelection(from, {...from, ch: from.ch + 1});

        this.clearInvalidPlaceholders();
    }

    clearAllPlaceholders() {
        for (let i = this.currentPlaceholders.length - 1; i >= 0; i--) {
            this.currentPlaceholders[i].marker.clear();
        }
    }

    private static rangeFromPlaceholder(placeholder: SnippetPlaceholder): MarkerRange {
        return (placeholder.marker.find() as MarkerRange);
    }

    private clearInvalidPlaceholders() {
        for (let i = this.currentPlaceholders.length - 1; i >= 0; i--) {
            if (!this.currentPlaceholders[i].marker.find()) {
                this.currentPlaceholders.splice(i, 1);
            }
        }
    }

    onunload() {
        this.clearAllPlaceholders();
    }
}

