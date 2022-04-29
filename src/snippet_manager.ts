import {Editor, EditorPosition} from "obsidian";
import {Range} from "@codemirror/rangeset";
import {Decoration} from "@codemirror/view";
import {editorToCodeMirrorState, editorToCodeMirrorView, indexFromPos, posFromIndex} from "./editor_helpers";
import {addMark, clearMarks, markerStateField, removeMarkBySpecAttribute} from "./marker_state_field";

const COLORS = ["lightskyblue", "orange", "lime", "pink", "cornsilk", "magenta", "navajowhite"];

export class PlaceholderReference {
    editor: Editor

    constructor(editor: Editor) {
        this.editor = editor;
    }

    get marker(): Range<Decoration> {
        const state = editorToCodeMirrorState(this.editor);
        const iter = state.field(markerStateField).iter();
        while (iter.value) {
            if (iter.value.spec.reference === this) {
                return {
                    from: iter.from,
                    to: iter.to,
                    value: iter.value
                };
            }

            iter.next();
        }

        return null;
    }

    removeFromEditor(): void {
        editorToCodeMirrorView(this.editor).dispatch({
            effects: removeMarkBySpecAttribute.of({attribute: "reference", reference: this}),
        });
    }
}

interface MarkerRange {
    from: EditorPosition,
    to: EditorPosition
}

export default class SnippetManager {
    private currentPlaceholderReferences: PlaceholderReference[] = [];

    handleSnippet(value: string, start: EditorPosition, editor: Editor) {
        let colorIndex = 0;
        for (; colorIndex < COLORS.length; colorIndex++) {
            if (!this.currentPlaceholderReferences.find(p => p.marker.value.spec.attributes.class.endsWith(colorIndex + "")))
                break;
        }

        if (colorIndex === COLORS.length) {
            console.log("Completr: No colors left for snippet, using random color");
            colorIndex = Math.floor(Math.random() * COLORS.length);
        }

        const editorView = editorToCodeMirrorView(editor);
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

                const reference = new PlaceholderReference(editor);
                let mark = Decoration.mark({
                    inclusive: true,
                    attributes: {
                        style: "border-width: 1px 0 1px 0;border-style: solid;",
                        class: "completr-suggestion-placeholder" + colorIndex
                    },
                    reference: reference
                }).range(
                    indexFromPos(editorView.state.doc, {line: start.line + lineIndex, ch: lineBaseOffset + i}),
                    indexFromPos(editorView.state.doc, {line: start.line + lineIndex, ch: lineBaseOffset + i + 1})
                );

                editorView.dispatch({effects: addMark.of(mark)});

                this.currentPlaceholderReferences.unshift(reference);
            }
        }

        this.selectMarker(this.currentPlaceholderReferences[0]);
    }

    consumeAndGotoNextMarker(editor: Editor): boolean {
        //Remove the placeholder that we're inside of
        const oldPlaceholder = this.currentPlaceholderReferences.shift();
        const oldRange = SnippetManager.rangeFromPlaceholder(oldPlaceholder);
        oldPlaceholder.removeFromEditor();

        //If there's none left, return
        if (this.currentPlaceholderReferences.length === 0)
            return false;

        const placeholder = this.currentPlaceholderReferences[0];

        const newRange = SnippetManager.rangeFromPlaceholder(placeholder);
        if (!newRange)
            return false;

        if (newRange.from.ch <= oldRange.from.ch && newRange.to.ch >= oldRange.to.ch) {
            //If the old placeholder is inside of the next one, we just move the cursor
            editor.setCursor({...newRange.to});
        } else {
            this.selectMarker(placeholder);
        }

        return true;
    }

    placeholderAtPos(pos: EditorPosition): PlaceholderReference {
        for (let i = this.currentPlaceholderReferences.length - 1; i >= 0; i--) {
            const placeholder = this.currentPlaceholderReferences[i];
            const range = SnippetManager.rangeFromPlaceholder(placeholder);
            //Removes invalid placeholders
            if (!range) {
                this.currentPlaceholderReferences.slice(i, 1);
                continue;
            }

            //Return the first one that matches, because it should be the one where we're at
            if (range.from.ch <= pos.ch && range.to.ch >= pos.ch)
                return placeholder;
        }

        return null;
    }

    selectMarker(reference: PlaceholderReference) {
        if (!reference)
            return;

        const from = posFromIndex(editorToCodeMirrorState(reference.editor).doc, reference.marker.from);
        reference.editor.setSelection(from, {...from, ch: from.ch + 1});
    }

    clearAllPlaceholders() {
        if (this.currentPlaceholderReferences.length === 0)
            return;
        const firstRef = this.currentPlaceholderReferences[0];
        const view = editorToCodeMirrorView(firstRef.editor);
        view.dispatch({
            effects: clearMarks.of(null)
        });

        this.currentPlaceholderReferences = [];
    }

    private static rangeFromPlaceholder(reference: PlaceholderReference): MarkerRange {
        const marker = reference.marker;
        if (!marker)
            return null;

        return {
            from: posFromIndex(editorToCodeMirrorState(reference.editor).doc, marker.from),
            to: posFromIndex(editorToCodeMirrorState(reference.editor).doc, marker.to)
        };
    }

    onunload() {
        this.clearAllPlaceholders();
    }
}
