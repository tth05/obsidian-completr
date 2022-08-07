import {Range, RangeSet, StateEffect, StateField} from "@codemirror/state";
import {Decoration, EditorView} from "@codemirror/view";

export const addMark = StateEffect.define<Range<Decoration>>(), clearMarks = StateEffect.define(),
    removeMarkBySpecAttribute = StateEffect.define<{ attribute: string, reference: any }>()

export const markerStateField = StateField.define<RangeSet<Decoration>>({
    create() {
        return Decoration.none;
    },
    update(value, tr) {
        value = value.map(tr.changes);

        for (let effect of tr.effects) {
            if (effect.is(addMark))
                value = value.update({add: [effect.value]/*, sort: true*/});
            else if (effect.is(clearMarks))
                value = value.update({filter: () => false});
            else if (effect.is(removeMarkBySpecAttribute))
                value = value.update({filter: (from, to, ref) => ref.spec[effect.value.attribute] !== effect.value[effect.value.attribute]});
        }

        return value;
    },
    provide: f => EditorView.decorations.from(f)
})
