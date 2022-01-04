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
