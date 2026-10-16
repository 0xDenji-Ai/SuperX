# SuperX

**Understand X. Fact-check as you scroll.**

[Install for Chrome](https://chromewebstore.google.com/detail/superx/clcflilaihhnnglfamdblhopokpnlioo) · [Download ZIP](https://github.com/bwjoke/SuperX/releases/latest/download/SuperX.zip) · [Website](https://superx.vip/) · [Support](https://github.com/bwjoke/SuperX/issues) · [简体中文](README.zh-CN.md) · [Privacy](PRIVACY.md)

SuperX is a Chrome / Edge extension that checks factual claims in visible X posts using your own API Key or official local Grok Build login. Answers stream into a right-hand column that follows X's theme, font and interface language. Your left navigation and original feed keep their layout.

**Source candidate: 0.9.0 (not released).** This candidate temporarily removes the explanation step and runs Fact Check directly. It asks for concise findings, relevant evidence and sources rather than retelling the post beside its original text. It also separates intermediate/tool-command output from the final answer and reports an incomplete check if no reader-facing answer arrives. The Chrome Web Store and GitHub stable download below remain **0.7.26**, which includes explanations. The behavior described under Features and Settings applies to the 0.9.0 candidate.

The 0.9.0 candidate adds **API Key** and **Grok Build (ACP / CLI)** connection choices, with setup guidance for **Windows x64 and Apple silicon / Intel macOS**. API Key remains the default; Build needs the separate `SuperX-Connector-0.9.0.zip` and an official login. See [connection setup](docs/CONNECTIONS.md). Both routes retain language following, custom prompts, comments, history and Token/model information. There is no automatic provider fallback or quota bypass.

The extension uses Manifest V3 and plain JavaScript. Browser-only API installation needs no build step or package dependencies. This is a Beta: X's changing page structure, model behavior and API availability can affect results.

![SuperX on X with English explanations and fact checks](docs/assets/superx-preview-en.png)

*SuperX 0.7.26 on X, showing English explanations and fact checks. The 0.9.0 candidate uses Fact Check only.*

## Downloads and support

| Entry | Purpose | Current status |
| --- | --- | --- |
| [Chrome Web Store — Stable](https://chromewebstore.google.com/detail/superx/clcflilaihhnnglfamdblhopokpnlioo) | Install and update through Chrome | 0.7.26 published |
| [Stable 0.7.26 ZIP](https://github.com/bwjoke/SuperX/releases/download/v0.7.26/SuperX.zip) | The same release for manual installation | Published |
| [Latest Preview](https://github.com/bwjoke/SuperX/releases) | Newer candidates when available; update manually | No newer Preview currently |
| [All GitHub Releases](https://github.com/bwjoke/SuperX/releases) | Versioned installation packages, source and checksums | Available |
| [Latest stable ZIP](https://github.com/bwjoke/SuperX/releases/latest/download/SuperX.zip) | Installation package of the latest stable GitHub release | 0.7.26 |
| [GitHub Issues](https://github.com/bwjoke/SuperX/issues) | Bugs, feature requests and shared support for both channels | Open |

[SuperX.vip](https://superx.vip/) is the website; [bwjoke/SuperX](https://github.com/bwjoke/SuperX) is the project home for source, release notes and support. Preview and Stable use the same code and version sequence; the store can lag behind newer previews. **GitHub's Latest entry means the latest stable release, not the latest preview.** Use the Releases list for previews. See [release channels](docs/RELEASE_CHANNELS.md) for the release and promotion process. [0.7.26 Stable](https://github.com/bwjoke/SuperX/releases/tag/v0.7.26) is available from the Chrome Web Store and GitHub; there is currently no newer Preview.

The user confirmed 0.7.26's core features on Chrome for Windows 11, and confirmed explanations, Fact Check and Key saving/restoration after installing the store version. Installed Edge acceptance remains pending.

## Features

- Visible posts enter the analysis queue immediately, with configurable API concurrency.
- A continuous right column replaces X's original sidebar; collapse it to restore that sidebar.
- Fact Check starts directly in one streamed request, without a preceding explanation or a duplicate post summary. Findings lead with the useful conclusion, evidence and any relevant limits.
- Built-in or editable fact-check and comment instructions.
- Auto answers follow the post's currently displayed language, including translation / original switches. You can also choose a fixed language.
- Streamed Markdown, clickable sources, per-post Token usage and model details.
- Three optional one-line comment drafts, copied only when you click; SuperX does not post them.
- Local result caching and specific failure details when a fact check cannot finish; any available partial findings remain readable.
- A searchable, on-device history of posts viewed in the last 24 hours, including already generated answers and comments; available after browser restart.

SuperX's AI features require either your own API Key or a connected official Grok Build login; local browsing history works without either. Build uses a separate native connector rather than clicking X’s Grok buttons. The X built-in Grok mode and URL-only interpretation mode were removed in version 0.7.0. SuperX is an independent project and is not affiliated with X or xAI.

## Install

Requirements: desktop Chrome or Chromium-based Edge 120+, and provider access to the selected model and search tools. API mode works in the browser; the optional Build connector supports Windows x64 and macOS arm64/x64. Actual Mac installed-browser acceptance remains pending.

For Chrome, install from the store:

1. Open [SuperX in the Chrome Web Store](https://chromewebstore.google.com/detail/superx/clcflilaihhnnglfamdblhopokpnlioo) and choose **Add to Chrome**.
2. Open SuperX settings, add your own xAI API Key and save. Enable SuperX and open X.
3. Chrome manages extension updates. If replacing an unpacked installation, disable the old copy first to avoid duplicate analysis and configure the store copy separately.

For Edge or a manual GitHub installation:

1. Open [**Releases**](https://github.com/bwjoke/SuperX/releases), choose a labelled Preview or Stable release and download the attached `SuperX-<version>.zip` or identical `SuperX.zip`. Extract it. Alternatively, download the source and use its `extension/` folder.
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Open SuperX settings, add your own xAI API Key and save. Enable SuperX and refresh X.

To upgrade a manual installation, replace the files in the folder you actually loaded, reload the extension, then refresh X. Keep that folder in a permanent location. The GitHub-generated source archive is different from the extension ZIP attached to a release.

Switching from an unpacked installation to the store is a separate installation, with no automatic settings or Key migration currently provided. Disable the old installation first to avoid duplicate analysis, then configure the new one.

## Set up your API Key

For The X Subscription, use [Grok Dashboard → API Keys](https://grok.com/dashboard/api-keys), select **Grok Inference** rather than the default **Cursor** type, and enable Chat / the required model permissions. Existing [xAI Console](https://console.x.ai/) Keys remain supported. Check your [usage dashboard](https://grok.com/dashboard/usage) and provider rules for entitlement, limits and charges. SuperX does not promise that every subscription includes free or unlimited API use.

Use a normal xAI API Key with available credit and access to your selected model and search tools. See [Privacy](PRIVACY.md) for the data sent and the provider's handling.

**Remember Key on this device** is checked on first setup. It encrypts the Key automatically in this browser profile and restores it after browser restart, with no password or unlock step. Uncheck Remember Key and save to remove the encrypted record and local encryption key, keeping your API Key only for the current browser session. Browser sync is not used. **Clear saved Key** removes the encrypted record, encryption key, obsolete Key records, session credential and cache, while keeping your remember preference.

Existing plaintext Keys and usable session Keys from older versions migrate automatically when Remember Key is selected; plaintext records are removed after the encrypted save succeeds. Missing or damaged saved data requires entering the API Key once again. Older password-encrypted records are not decrypted and remain only until successful migration, replacement or clearing. Automatic encryption protects against exposure of the stored ciphertext alone; it does not protect against access to the full browser profile or a compromised device. See [Privacy](PRIVACY.md) for storage details.

In API mode, requests go directly from the extension's background worker to `api.x.ai`; the project does not operate a relay server. The Key is not passed to the X page's content script. Analysis uses your Key when SuperX is enabled. Clearing or replacing the Key cancels queued and active requests and clears the session cache; already sent work may still be billed. Read [Privacy](PRIVACY.md), especially on pages that show non-public posts.

## Settings and behavior

API mode: choose the model and reasoning effort from separate dropdowns. Models offered are `grok-4.3`, `grok-4.5`, `grok-4.6` and `grok-4.7`, with only supported effort levels shown. The default remains Grok 4.3 with no reasoning and 4 concurrent requests; existing 4.5–4.7 settings retain low effort, and already saved custom model IDs remain available. Higher effort may increase latency and Token use; it does not enable Fast/Priority processing. Concurrency can be set from 1 to 8, and availability depends on your xAI account. At least one of **X search** or **Web search** must be enabled: both built-in and custom modes use the original post URL as their primary context and request its full text, including content hidden behind **Show more**. Retrieval can fail; the extension cannot guarantee that a model has obtained every part of a thread or inspected its media.

The 0.9.0 candidate runs **Fact Check only**. It retrieves the linked post and checks its material factual claims in one streamed generation request. It does not first generate an explanation, paraphrase the post or append a second fact-check request. Only quote the minimum needed to identify a disputed claim; if there is no checkable factual claim, say so briefly rather than inventing a verdict. A sourced answer can still be mistaken.

Custom mode lets you edit the fact-check and comment prompts. Blank instructions use the defaults; each prompt accepts up to 12,000 characters. Saving new prompts affects new tasks. Use **Reanalyze** to apply them to an existing answer. Application rules still enforce the selected language, safe handling of source material, avoiding duplicate post recaps and comment output format. Earlier explanation settings no longer select a separate generation step; existing saved history, including earlier explanations, remains readable until its usual expiry or deletion.

Language settings contain two independent choices, both **Auto** by default. **Grok answer language** first uses the valid language mark on X's currently displayed post text, then falls back to the author's displayed prose. Quoted posts and search results do not choose the language. A fixed answer language overrides translation / original switches. **SuperX interface language** follows X's UI language in Auto; before X has reported a language, it uses the browser interface language. You can choose a fixed interface language for the rail, Settings and popup. Twelve UI languages are supported, with English as fallback. Changing only the interface language preserves answers and in-progress requests.

Collapse the right column with its top chevron; click the SuperX symbol to expand it. Collapse cancels tasks that have not started; started tasks may finish and their results are retained. Leaving a post's viewport cancels queued work immediately and running work after about one second. Backgrounding, refreshing or closing a tab stops that page's tasks. Requests already sent may still be billed.

## Costs and cache

Automatic analysis can generate paid requests for every visible post. All X tabs share the configured request slots; excess work queues. Build uses a separate serial queue and its own model / effort selections; check host availability in Settings. There is no extension-level post-count limit or spending cap. Faster scrolling, more tabs, search tools and **Reanalyze** can increase usage. The 0.9.0 candidate uses one generation request per fact check; comment suggestions use another request. Removing the separate explanation step avoids that extra request, but retrieval and model processing can still take time. A single request can invoke search tools multiple times. Missing final answers are shown as incomplete without an automatic paid retry. Check pricing and actual charges in the xAI console.

The per-post Token display uses API-reported usage for the current fact check and comments. Hover it for model and stage details. It does not total earlier reanalyses or all account spending. Cached results show their original usage and that no new usage was incurred for that cache hit; partial or missing statistics are marked rather than estimated.

Completed results are reusable for up to 24 hours within the current browser session, with a limit of 160 entries and approximately 4 MB. Cache identity includes the post, model, reasoning effort, answer language, search options, generation flow and effective prompts. Cached results use trusted session storage and are removed when the browser session ends or credentials change. Old persistent caches are removed on upgrade. Expired entries are pruned when the worker starts and when new entries are saved; the 24 hours is a reuse limit, not an exact-time deletion timer within an open session. **Clear cache** removes the session cache. See [Privacy](PRIVACY.md) for what entries contain.

## Browsing history

Open **Browsing history** from the right-column header, extension popup or Settings. It lists supported posts actually visible while SuperX and history recording are enabled, with no dwell delay and no API Key required. Recording is enabled by default. Repeated views of a post are merged and move it to the top; its retention period is 24 hours after the latest view.

The history stores the displayed post text, author, URL, language, viewing times and available generated answers, sources, Token/model details and comment drafts in restricted `chrome.storage.local`. It survives browser restart, is not encrypted or synced, and is bounded to 1,000 posts and approximately 6 MB. Storage limits may remove older entries before 24 hours. It does not preserve a full post archive or save images. Opening, searching or expanding a saved answer makes no API request and does not preload remote images. Opening an original post or source link visits that website.

Search posts, authors and saved answers; remove individual entries or use **Clear history** to delete everything saved there. Turn off **Save browsing history** to stop new records and answer updates without deleting existing entries. Expired records are excluded from history views and pruned on startup, history reads/writes and an hourly background alarm. Browser shutdown, scheduling delays or storage errors can delay physical cleanup; there is no exact-time deletion guarantee.

History is separate from the API result cache: **Clear cache**, clearing/replacing the API Key and ending the browser session do not delete it. **Clear history** does not delete the Key or result cache, and does not erase an answer already displayed in X. Viewing history never automatically resumes analysis. Private or protected posts can be retained if they were visible on a supported page; see [Privacy](PRIVACY.md).

## Future direction

**Let your AI agent understand what you've been reading on X.** A future direction is user-controlled sharing of selected posts and saved explanations from SuperX's browsing history with your own AI agent, giving it context for follow-up research, discussion and writing. Agent integration is not available in the current release.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No answers | Enable SuperX, save a valid Key, enable at least one search tool and refresh X after installing or reloading |
| Wrong answer language | Select Auto to follow the displayed post, or choose your preferred fixed language; cached answers are separated by target language |
| Fact check incomplete | Expand the result's diagnostic details; possible causes include an output limit, connection failure, language mismatch, timeout, rate limit or account access |
| Requests stop after a rate limit | Wait for your API allowance to recover, then reanalyze manually; SuperX does not automatically pay for retries |
| Unusual sidebar layout | Reload the extension and refresh X; report the page type, browser version and a redacted screenshot |

An answer with sources is not a guarantee of correctness. An incomplete fact check does not certify the post. Any partial findings are labelled incomplete; retry manually when appropriate.

## Development

Use **Node.js 22 or newer**. No `npm install` is needed for the extension, tests or local preview.

```sh
node tools/validate.mjs
node tools/preview-server.mjs
npm run package
```

The validator checks declared resources, JavaScript syntax and automated tests. The preview server prints a local URL and uses simulated storage and answers; it does not read your installed extension's Key or call the paid API. Continuous integration runs the validator and produces installation artifacts. See [Contributing](CONTRIBUTING.md) for development and [the release checklist](docs/RELEASE_CHECKLIST.md) for acceptance status. CI artifacts do not by themselves publish a GitHub Release. The website is maintained separately and is not part of this repository or its source release.

| Folder | Contents |
| --- | --- |
| `extension/` | Files loaded by the browser |
| `tests/` | Automated regression tests with mocked browser and provider APIs |
| `demo/` | Local UI previews using production code |
| `tools/` | Validation, preview and release helpers |
| `connector/` | Windows/macOS installer and restricted local Grok Build host |
| `docs/` | Release channels, acceptance checklist and the README preview image |

Some internal module and storage names retain GrokFirst identifiers for upgrade compatibility. Changes to them need migration review.

## License

Project code and documentation are available under the [MIT License](LICENSE). The bundled Marked parser retains its [third-party license](extension/marked-LICENSE.txt).

For security reports, follow [SECURITY.md](SECURITY.md). Do not include API Keys or private post contents in public issues.
