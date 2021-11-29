import {MarkerRange, TextMarker} from "codemirror";
import {Editor, EditorPosition} from "obsidian";
import * as CodeMirror from "codemirror";

const COLORS = ["lightskyblue", "cornsilk", "orange", "pink", "green", "magenta", "navajowhite"];

export type SnippetPlaceholder = {
    marker: TextMarker,
    editor: Editor
}

export default class SnippetManager {
    private currentPlaceholders: SnippetPlaceholder[] = [];

    handleSnippet(value: string, start: EditorPosition, editor: Editor) {
        let color = COLORS.filter(color => !this.currentPlaceholders.find(p => p.marker.css.endsWith(color))).first() ??
            COLORS[Math.floor(Math.random() * COLORS.length)];

        for (let i = value.length - 1; i >= 0; i--) {
            let c = value.charAt(i);
            if (c !== "#")
                continue;
            let placeholder = {
                marker: (
                    // @ts-ignore
                    editor.cm as unknown as CodeMirror.Doc
                ).markText(
                    {...start, ch: start.ch + i},
                    {...start, ch: start.ch + i + 1},
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

        this.selectMarker(this.currentPlaceholders[0]);
    }

    consumeAndGotoNextMarker(editor: Editor): boolean {
        this.clearInvalidPlaceholders();
        //Remove the placeholder that we're inside of
        let oldPlaceholder = this.currentPlaceholders.shift();
        let oldRange = SnippetManager.rangeFromPlaceholder(oldPlaceholder);
        oldPlaceholder.marker.clear();

        //If there's none left, return
        if (this.currentPlaceholders.length === 0)
            return false;

        let placeholder = this.currentPlaceholders[0];

        let newRange = SnippetManager.rangeFromPlaceholder(placeholder);
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

        for (let placeholder of this.currentPlaceholders) {
            let range = SnippetManager.rangeFromPlaceholder(placeholder);
            //Return the first one that matches, because it should be the one where we're at
            if (range.from.ch <= pos.ch && range.to.ch >= pos.ch)
                return placeholder;
        }

        return null;
    }

    selectMarker(placeholder: SnippetPlaceholder) {
        let range = placeholder.marker.find() as MarkerRange;

        let from = {...range.from, ch: range.from.ch};
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

