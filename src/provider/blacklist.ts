import {getSuggestionDisplayName, Suggestion} from "./provider";
import {Vault} from "obsidian";

const BLACKLIST_PATH = ".obsidian/plugins/obsidian-completr/blacklisted_suggestions.txt";
const NEW_LINE_REGEX = /\r?\n/;

export const SuggestionBlacklist = new class {
    private blacklist: Set<string> = new Set<string>();

    add(suggestion: Suggestion) {
        this.blacklist.add(getSuggestionDisplayName(suggestion));
    }

    has(suggestion: Suggestion): boolean {
        return this.blacklist.has(getSuggestionDisplayName(suggestion));
    }

    filter(suggestions: Suggestion[]): Suggestion[] {
        if (this.blacklist.size < 1)
            return suggestions;

        return suggestions.filter(s => !this.blacklist.has(getSuggestionDisplayName(s)));
    }

    async saveData(vault: Vault) {
        await vault.adapter.write(BLACKLIST_PATH, [...this.blacklist].join("\n"));
    }

    async loadData(vault: Vault) {
        if (!(await vault.adapter.exists(BLACKLIST_PATH)))
            return

        const contents = (await vault.adapter.read(BLACKLIST_PATH)).split(NEW_LINE_REGEX);
        for (let word of contents) {
            if (!word)
                continue;

            this.add(word);
        }
    }
};
