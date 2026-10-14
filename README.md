## Surfing

[中文文档](README-ZH.md) ｜ [English Doc](README.md)

## Introduction

An [Obsidian](https://obsidian.md/) plugin that allows you to browse the web within Obsidian using v1.0 tabs.

The core functionality of the plugin, rendering a web view, is greatly influenced
by [Ellpeck's Obsidian Custom Frames](https://github.com/Ellpeck/ObsidianCustomFrames) plugin and this plugin wouldn't
have been possible without it.

![](assets/obsidian-web-browser.png)

## TODO

- [ ] Support extensions
- [ ] Support custom CSS
- [ ] Support custom JS

## Feature

- Core Feature
	- Browse arbitrary web pages: The plugin hijacks Obsidian's file, http, https protocols, enabling links to be opened
	  directly in Obsidian, rather than in external browsers. Yes, local HTML and other resources are also supported.
	- Editor web search: You can select keywords in the editor and then right-click to open them in web-browser and
	  search using the default search engine.
	- In-page web search: Again, you can right-click within a web page to use the default search engine search.
	- Copy links pointing to highlights: As with the browser, you can select text and copy the links pointing to it.
	- Use BookmarkLets in your browser to open the URL directly in Obsidian.
	- Copy video timestamp (experimental feature: currently only bilibili is supported): right click on the text to pop
	  up the menu to copy the timestamp, currently there are some bugs, it is known that sometimes the menu does not pop
	  up.
- Auxiliary Feature
	- Open current URL with external browser: right-click menu
	- Default search engine: setting item
	- Default copy highlighted template: setting item (currently only supports very simple templates), please avoid
	  using some special characters
	- AI assistant sidebar: a right panel can chat with local Codex/Claude CLI and trigger page actions
	- Support browsing history: Jump back and forth to the page
	- Clear browsing history: command panel
	- All links are opened in the same panel on the right: Settings
	- Toggle whether to open in the same panel on the right: command panel
	- Simple dark mode: just simple

### AI Assistant Sidebar

You can enable `AI Assistant Sidebar` in `Settings > Surfing > General` to show a right-side chat panel in each Surfing page.

- Default providers include `Codex` and `Claude Code`, and both can be mapped to local CLI commands.
- Supports placeholders in command arguments: `{prompt}`, `{url}`, `{title}`, `{selection}`, `{page_text}`.
- The assistant can return structured actions (`navigate`, `click`, `type`, `scroll`, `extract`, etc.) to operate the current page.

### Chrome Extensions (experimental, desktop)

Surfing can run Chrome extensions such as Tampermonkey, uBlock Origin Lite, Dark Reader or Read Frog. This used to be the separate *Chrome Extensions Bridge* plugin.

- **Where extensions run:** while Obsidian's core **Web Viewer** plugin is enabled, extensions run in Web Viewer tabs, and Surfing leaves external links to Web Viewer (Surfing's own view stays available from its commands and menus). With Web Viewer disabled, extensions run in Surfing tabs. Switching the core plugin moves the extensions over automatically. Each browser has its own session, so extension data (settings, cookies) is kept separately for each.
- **Install** from the Chrome Web Store (open the store with the command *Open Chrome Web Store*, then click *Install to Obsidian* in the tab header), from a store link or extension ID, or from a local `.crx`, `.zip` or unpacked folder. Manage everything in *Settings → Surfing → Extensions*.
- **Use:** every browser tab header has a puzzle button listing your extensions; pinned extensions get their own button with icon and badge. Extension context menu items appear in the page's right-click menu, and manifest commands appear in the command palette, where you can bind hotkeys.
- **Requirements:** Obsidian installed from a 1.12.4 or later installer (Electron 39 or later). Electron is bound to the installer; on older installs Surfing works as before, without extensions. Extensions can't load while Surfing's *session isolation* is on.
- **Coming from Chrome Extensions Bridge?** Disable that plugin, then use *Import* in *Settings → Surfing → Extensions*. Extensions installed from local folders get a new extension ID, so their data starts fresh.

## Usage

### Use BookmarkLets Open URL

The plugin registers an Obsidain uri protocol that allows you to open eb-broswer in Obsidian using the
URL `obsidian://web-open?url=<url>`. Where `<url>` refers to the web address link.
Match [bookmarklets](https://en.wikipedia.org/wiki/Bookmarklet) will be able to click a bookmark in the browser to open
the current browser URL within Obsidain.

1. Open the `Open URL In Obsidian Web` option in the plugin settings.
2. Under this option there is a link of bookmarklets, drag this link into your browser's bookmark bar. You can also
   click this link(will copy bookmarklets code), then create bookmarklets by yourself.
3. Now you can click on the bookmark to open the current page of your browser in Obsidian.

### Use Quickadd to search selection in ChatGPT in Surfing

1. Create a macro based on this
   script: [search-in-surfing](https://gist.github.com/Quorafind/c70c6c698feeed66465d59efc39e4e1c)
2. Open ChatGPT in surfing, and select some text, then run the macro.

## Installation

- Search `Surfing` in the Obsidian Community Plugin marketplace.
- Can be installed via the [Brat](https://github.com/TfTHacker/obsidian42-brat) plugin
- Manual installation

1. Find the release page on this github page and click
2. Download the latest release zip file
3. Unzip it, copy the unzipped folder to the obsidian plugin folder, make sure there are main.js and manifest.json files
   in the folder
4. Restart obsidian (do not restart also, you have to refresh plugin list), in the settings interface to enable the
   plugin
5. Done!

## Contribution

- [Windily-cloud(皮皮)](https://github.com/windily-cloud) - Chinese translation && Features

## Support

If you are enjoying this plugin then please support my work and enthusiasm by buying me a coffee
on [https://www.buymeacoffee.com/boninall](https://www.buymeacoffee.com/boninall).
.

<a href="https://www.buymeacoffee.com/boninall"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=boninall&button_colour=6495ED&font_colour=ffffff&font_family=Lato&outline_colour=000000&coffee_colour=FFDD00"></a>
