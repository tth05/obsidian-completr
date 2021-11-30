import SuggestionProvider from "./provider";
import {EditorSuggestContext} from "obsidian";
import {readFile} from "fs/promises";
import {CompletrSettings} from "../settings";
import {readFileSync} from "fs";

class WordListSuggestionProvider implements SuggestionProvider {

    private wordMap: Map<string, string[]> = new Map<string, string[]>();

    getSuggestions(context: EditorSuggestContext): string[] {
        const list = this.wordMap.get(context.query.charAt(0));
        if (!list || list.length < 1)
            return [];

        //TODO: Rank those who match case higher
        return list.filter(s => s.toLowerCase().startsWith(context.query.toLowerCase()));
    }

    loadFromFiles(settings: CompletrSettings) {
        this.wordMap.clear();

        //Read all files
        for (let i = settings.worldListFiles.length - 1; i >= 0; i--) {
            let data: string;
            try {
                data = readFileSync(settings.worldListFiles[i])?.toString();
            } catch (e) {
                settings.worldListFiles.splice(i, 1);
                continue;
            }

            //Each line is a word
            const lines = data.split("\n");
            for (let line of lines) {
                if (line === "" || line.length < settings.minWordLength)
                    continue;

                let list = this.wordMap.get(line.charAt(0));
                if (!list) {
                    list = [];
                    this.wordMap.set(line.charAt(0), list);
                }

                list.push(line.trim());
            }
        }

        let count = 0;
        //Sort by length
        for (let entry of this.wordMap.entries()) {
            entry[1] = entry[1].sort((a, b) => a.length - b.length);
            count += entry[1].length;
        }

        if (count > 0)
            console.log("Completr: Loaded " + count + " words");
    }
}

export const WordList = new WordListSuggestionProvider();
