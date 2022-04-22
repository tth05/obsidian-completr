# Completr
[![](https://img.shields.io/github/v/release/tth05/obsidian-completr?style=flat-square)](https://github.com/tth05/obsidian-completr/releases)
![](https://img.shields.io/github/downloads/tth05/obsidian-completr/total?style=flat-square)

This plugin provides advanced auto-completion functionality for obsidian.

## Features
- Latex support
    - No need to start with a `\`
    - Includes all MathJax commands
    - Allows `\begin...` completion for all environments
    - Support for inserting snippets with placeholders
- YAML Front Matter support
    - Learns any key with any value and provides completions for them
- Word list support
    - Load files where each line is a word
    - Performant, even with very big [lists](#looking-for-word-lists)
- Scanning your vault for words
    - Scans the current file or your whole vault to find new words which can then be suggested

## Installation
### Community plugin list
Browse the community plugins list and search for `Completr`.
### Manually
- Download `main.js, styles.css` and `manifest.json` from a release of your choice
- Copy the three files to your vault `VaultFolder/.obsidian/plugins/obsidian-completr/`

### After installation
1. Restart obsidian to ensure internal hooks can get registered properly
2. Check out the [hotkeys](#configuring-hotkeys) section to further configure the plugin

## Configuring hotkeys
- All hotkeys are changeable from the hotkeys settings page
- The "bypass" hotkeys are useful to run actions which pretend that the popup isn't open.
    - If for example your insertion key is `Enter`, you couldn't press enter to go to the next line while the popup is open. This is where you could use the bypass key.
    - This also allows for other modifiers to be used, for example pressing `Tab` might require holding `Shift` to move backwards. Only modifiers which are not used in the bypass keybinding will be forwarded.
- If you want to change a hotkey without using any modifier, you need to use a workaround which can be found [here](https://forum.obsidian.md/t/be-able-of-using-the-function-keys-f1-f12-to-perform-functions/15748/7) or [here](https://forum.obsidian.md/t/function-keys-cant-be-bound-as-hotkeys-without-modifiers/26956/4), as Obsidian currently does not support this.

## Example usage
#### Latex snippets
![Latex](https://user-images.githubusercontent.com/36999320/146680089-57390cd7-e3c3-418c-9c55-9536259bb956.gif)
#### YAML Front Matter
![Front matter](https://user-images.githubusercontent.com/36999320/148700639-6cb48631-0b2f-45b8-b48a-40357425e8bf.gif)
#### File scanning
![File scanner](https://user-images.githubusercontent.com/36999320/146680134-33d8393b-956a-4028-ab2f-62526f76984d.gif)
#### Two million german words loaded
![Word list](https://user-images.githubusercontent.com/36999320/146680359-ae572473-8919-4927-a6f5-bc39800a5c23.gif)

## Looking for word lists?
- https://sourceforge.net/projects/germandict/
- https://github.com/kpym/FrequencyDictionaries

## Development
- Clone the repo to the `plugins` folder of an obsidian vault
- Run `npm i` and `npm run dev`
- Enable the plugin in obsidian
