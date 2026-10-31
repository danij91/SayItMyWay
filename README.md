<p align="center"><img src="extension/icons/normal.svg" width="88" alt="SayItMyWay"></p>

<h1 align="center">SayItMyWay</h1>
<p align="center">Replace website text your way.</p>
<p align="center"><a href="LICENSE">MIT License</a> · Chrome Manifest V3 · 15 languages · Local-first</p>

A free Chrome extension that replaces website text using **source → replacement tables**. Translate menus, use familiar names for game terms, or change wording to suit your preferences.

New installations start with no tables or site assignments. Create your own tables, collect page text, or import a JSON file.

No account, subscription, or donation required. There are no paid limits on saved sites or simultaneously enabled sites. Unlike an automatic translator, SayItMyWay replaces only the text you specify and does not automatically call translation APIs.

## Features

- **Manage tables:** Search, add, edit, and delete entries; duplicate tables; import and export JSON.
- **Configure each site:** Choose one table per page and toggle replacement on or off. Set case sensitivity and word replacement within sentences per site.
- **Handle dynamic content:** Replace text in menus and popups as they appear. Turn replacement off to restore the original text.
- **Collect source text:** Create a new table from a page or append only new entries to an existing table.
- **Prepare AI requests:** Copy or download a translation or rewriting request. Import the AI's response to fill empty replacements while preserving existing work.
- **Edit on the page:** Use shortcuts to preview original text or add, edit, and delete entries directly on a webpage.
- **Convert currencies:** Convert displayed prices using ECB reference rates, independently of text replacement. Cached rates remain available offline.
- **Use your language:** English, Korean, Japanese, Simplified and Traditional Chinese, Spanish, French, German, Brazilian Portuguese, Russian, Indonesian, Vietnamese, Thai, Hindi, and Arabic with RTL support.

## How it works

### Apply a table

Open the table manager using the table icon at the top of the popup. Create a table or import JSON, enter source and replacement text, and **save** your changes. On a website, choose that table in the popup and turn on **text replacement**. Chrome will request site access the first time it is needed.

Choose **Import** in the popup or table manager, then select **File** to open a JSON file or **Clipboard** to import copied JSON. Clipboard access is requested when you choose it; the extension does not monitor your clipboard. Ordinary JSON creates a new table, while linked AI results show a preview before you apply them.

Switching tables while replacement is enabled applies the new table. Empty replacement values leave the original text unchanged. Nonempty values apply directly. Entries can include optional notes and a CSS selector to limit replacement to part of a page.

New site assignments default to the current page, rather than the whole domain. Expand the sites panel to manage table assignments and enabled states. Each row's settings button lets you edit the website URL and choose the current page, pages under that path, or the entire site, as well as case sensitivity and replacement within sentences. The open-site button opens the saved URL, including its path, even when the matching scope is the entire site. Query strings and fragments are retained for navigation but do not affect matching. Changing to another domain requests Chrome site access; declining leaves the saved assignment unchanged. Existing broad assignments keep their scope until you edit them. By default, the entire text must match. Word replacement checks word boundaries, and substitutions are calculated from the original text in one pass: rules A → B and B → C do not turn A into C.

### Collect text and work with AI

- **New collection:** Create a new table from the current page's source text.
- **Append collection:** Add text missing from the selected table without changing existing replacements.
- Open menus yourself during collection to capture newly displayed text. The extension does not automatically click hidden menus. Finish collection when you are done.
- **AI requests** are independent of collection and use the selected table. Choose languages or describe how you want the text rewritten, then copy the request or download it as a file.
- Send the request to your chosen AI and import its JSON response for review. Linked responses fill only entries that were empty when requested and have not since been changed. Ordinary JSON imports create a new table.

Requests include source text, existing replacements, and context such as the website address. Check for sensitive information before sharing a request with an external AI. The extension does not send it automatically.

### Shortcuts and saving

- Hold **Left Shift** to preview the original text by default.
- Hold **Left Alt and click text** to open the page editor by default.
- Popup settings let you enable each shortcut, change its keys, and choose **Hold** or **Toggle**. Settings save immediately.
- Changes in the table manager require its **Save** action. Edits made on a webpage are saved through the page editor.
- The sites and currency panels start collapsed and independently remember their last expanded or collapsed state.

Choose different keys if a shortcut conflicts with your browser or a website. Shortcuts do not run inside input fields, editable content, or during IME composition.

### Currency conversion

At the bottom of the popup, choose source and target currencies and turn conversion on. It works independently of text replacement and does not require a table.

- **Auto:** Resolve ambiguous symbols such as `$` or `¥` only when explicit page metadata identifies a single currency.
- **All currencies:** Convert supported amounts whose currency can be identified clearly.
- **Specific currency:** Convert only amounts in the selected source currency.

The extension checks [ECB daily reference rates](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml) when conversion is first enabled and every six hours while in use. Manual refresh is also available. If a refresh fails, it uses the last valid rates or bundled fallback rates and displays their date and status.

**Converted prices are estimates; checkout amounts are not changed.** Card issuer rates and fees may differ. Ambiguous symbols, numbers without a currency, prices split across multiple elements, and dual-currency labels may remain unchanged.

## Data, permissions, and limitations

- Tables are stored in the browser's **IndexedDB**; site settings use **chrome.storage.local**. There is no account-based sync or upload to an application server.
- Removing the extension or browser profile may delete your data. Export tables as JSON if you need to keep or move them.
- Text replacement and collection require access to the selected website. ECB access and scheduled alarms support exchange-rate updates.
- The extension replaces DOM text and selected attributes (`title`, `aria-label`, and `alt`). Input values, editable content, and input placeholders are protected.
- **Text inside images, canvases, iframes, or website Shadow DOM is not supported.** Sentences split across multiple elements are not joined. Restricted pages, such as Chrome's internal pages, cannot be modified.
- Site search logic, layout, and fonts are not changed. Some sites may require searching with the original wording, and replacement text may be clipped by the site's layout.
- ECB requests do not include page text, prices, or tables. When you share an AI request or open an external link, that service's policies apply.

## Development

Use Node.js **22 or later**.

```sh
npm ci
npm test
npm run build:extension
```

The build produces `dist/extension/` from an explicit list of extension files, excluding developer tools, personal tables, and development fixtures.

Some native browser checks require a separate Playwright/Chromium environment and may be skipped by the default test run. The `tests/*browser.mjs` scripts are optional checks; see each file for environment variables and prerequisites.

To inspect bundled application content:

```sh
npm run dev:tools
```

Open `http://127.0.0.1:4318/` to browse AI prompts, UI strings, and development fixtures. This developer tool does not read user tables and is not needed to use the extension. Stop it with `Ctrl+C`.

| Path | Contents |
| --- | --- |
| `extension/` | Extension, popup, table manager, and replacement engine |
| `extension/locales/` | UI translations and AI request wording |
| `extension/data/` | Development fixtures and bundled fallback exchange-rate data |
| `examples/` | Importable example tables |
| `tests/` | Automated tests and optional browser checks |
| `scripts/` | Build and development tools |
| `tools/devtools/` | Developer content browser |

`npm start` runs a legacy file-based development tool. The current extension neither requires that server nor synchronizes with it.

## License

The original project code is available under the **[MIT License](LICENSE)**. Personal and commercial use, modification, and redistribution are permitted, provided the copyright and license notices are retained. Third-party libraries, data, and trademarks remain subject to their own rights and terms. See [Third-party notices](THIRD_PARTY_NOTICES.md).

Report bugs and suggest improvements through [GitHub Issues](https://github.com/danij91/SayItMyWay/issues). Do not include passwords, tokens, private tables, or other sensitive information in public issues.
