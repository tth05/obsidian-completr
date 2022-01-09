import {Text} from "@codemirror/text";
import {Editor, EditorPosition} from "obsidian";
import {EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";

export function posFromIndex(doc: Text, offset: number): EditorPosition {
    let line = doc.lineAt(offset)
    return {line: line.number - 1, ch: offset - line.from}
}

export function indexFromPos(doc: Text, pos: EditorPosition): number {
    const ch = pos.ch;
    const line = doc.line(pos.line + 1);
    return Math.min(line.from + Math.max(0, ch), line.to)
}

export function editorToCodeMirrorState(editor: Editor): EditorState {
    return (editor as any).cm.state;
}

export function editorToCodeMirrorView(editor: Editor): EditorView {
    return (editor as any).cm;
}

export function matchWordBackwards(
    editor: Editor,
    cursor: EditorPosition,
    charValidator: (char: string) => boolean,
    maxLookBackDistance: number = 50
): { query: string, separatorChar: string } {
    let query = "", separatorChar = null;

    //Save some time for very long lines
    let lookBackEnd = Math.max(0, cursor.ch - maxLookBackDistance);
    //Find word in front of cursor
    for (let i = cursor.ch - 1; i >= lookBackEnd; i--) {
        const prevChar = editor.getRange({...cursor, ch: i}, {...cursor, ch: i + 1});
        if (!charValidator(prevChar)) {
            separatorChar = prevChar;
            break;
        }

        query = prevChar + query;
    }

    return {query, separatorChar};
}
