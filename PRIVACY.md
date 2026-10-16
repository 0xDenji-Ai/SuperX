# Privacy and data handling

This document describes SuperX 0.8.0's Fact Check data flow. It applies to the xAI API mode, not the removed X built-in Grok mode. Last updated: 2026-10-16. The currently published 0.7.26 stable release retains its earlier explanation-then-check flow.

## Setup and control

SuperX uses your own xAI API Key directly. Add the Key in settings, save it, and enable analysis; there is no separate data-consent checkbox or ZDR-attestation step. Pause analysis to stop automatic requests. Clearing or replacing the Key cancels queued and active work and clears the previous session Key and session cache; this does not recall data already sent to xAI.

## What is sent to xAI

When analysis is enabled, the Key is available and a visible post enters the queue, SuperX sends an HTTPS request directly to `api.x.ai` from its extension background worker. The request includes:

- The canonical original post URL and post ID.
- The author's currently displayed post text, its language mark, author label and timestamp.
- Media presence and up to four eligible X-hosted image URLs with their accessible descriptions, plus available quoted-post context. A URL or thumbnail is not a promise that the model inspected the media.
- Your selected model, answer language, search settings and effective fact-check instructions, including custom prompts if selected.
- The existing Fact Check for an optional comment-drafting request. Fact Check itself uses one generation request and does not receive an earlier explanation.

The API Key is sent as the request's authentication credential. Search-enabled requests ask xAI's tools to retrieve the original post and relevant evidence; provider tools may retrieve further posts, pages or media. SuperX does not independently preload every complete post or video.

The extension does not restrict analysis to public posts. **Protected posts, replies and posts visible in likes or bookmarks can be included if they appear as supported post elements on an enabled page.** A provider may be unable to retrieve them by URL, but the visible text can still be sent as supporting context. Pause SuperX before opening pages whose contents you do not want sent, or remove the Key.

Direct-message and standalone Grok pages are excluded from analysis and history recording. The extension does not read X authentication cookies, access the browser's history of other sites or send X session credentials to xAI. Its separate, on-device history records supported X posts actually visible while SuperX and history recording are enabled, as described below. It does not post, reply, like or repost. Comment suggestions remain drafts; a click copies a selected draft through the browser clipboard API.

## Third parties and network requests

The project does not operate an API relay, analytics service or telemetry endpoint. That does not mean no data leaves your device: analysis and comment requests go to xAI, whose handling is governed by its own terms, policies and account configuration.

SuperX's use and transfer of user data adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements. Post content and related browsing activity are used only for factual-claim analysis, reply-drafting and on-device recent-history features and necessary caches; they are not used for advertising, data sales, credit decisions or unrelated profiling.

Requests set `store: false` in the xAI Responses payload. This describes the extension's request option; **it is not a guarantee that xAI retains no request data, logs or tool inputs**. Review the provider's current policies for your account before using non-public or sensitive material.

xAI's account configuration and terms remain applicable. Its [API security documentation](https://docs.x.ai/developers/faq/security) describes default retention and optional team-wide ZDR; its [Data Processing Addendum](https://x.ai/legal/data-processing-addendum), effective September 22, 2026, separately requires ZDR-enabled processing for Personal Data. Public posts can contain Personal Data. SuperX does not check or configure these provider-side requirements, and a normal Key or `store: false` does not establish compliance. See also the [API Enterprise Terms](https://x.ai/legal/terms-of-service-enterprise).

Model-provided Markdown is parsed locally. SuperX does not execute model HTML or load model-provided images. Safe HTTP(S) source links open only when clicked. Opening a source, the API console or a help link is a separate interaction with that website and its policies. X itself continues its usual page requests independently of SuperX.

## What remains on your device

| Data | Storage and lifetime |
| --- | --- |
| API Key with Remember Key checked | AES-GCM ciphertext in local extension storage (`apiKeyEncrypted`), until cleared or replaced; default preference for first setup and automatically restored after browser restart |
| Local encryption key | A separate, randomly generated, non-extractable CryptoKey in extension IndexedDB; removed when Remember Key is disabled or saved credentials are cleared |
| API Key with Remember Key unchecked | Browser session extension storage and necessary runtime memory; not deliberately persisted across sessions |
| Obsolete plaintext or password-encrypted Key records | Plaintext is removed after successful migration; old password-encrypted records are not decrypted and remain only until successful migration, replacement or clearing |
| Settings, custom prompts, remember preference and last reported X interface language | Local extension storage until changed or extension data is removed |
| Completed analyses and comments | Browser session result cache, reusable for up to 24 hours within that session, bounded to 160 entries and approximately 4 MB; removed when the browser session ends |
| Recent X browsing history | Unencrypted, restricted local extension storage (`superxHistory`), retained for 24 hours after each post's latest view across browser restart; bounded to 1,000 posts and approximately 6 MB |
| Per-tab counters, collapse state and session interface language | Session extension storage |
| Active page snapshots, partial answers and queued jobs | Runtime memory while their page / worker remains active |

Session cache entries contain generated text or comments, sources, model and usage metadata, completion times and cache identities. Those identities can include the post URL, selected settings, effective prompts, and—for comment drafts—the visible post / quotation snapshot and earlier analysis. Cached output can repeat the original post's contents. Treat the cache as potentially sensitive, not merely an anonymous performance index. Cache contents are not deliberately saved to persistent local storage. On upgrade, old local caches are removed rather than imported.

Browsing history is a separate persistent record, enabled by default. While SuperX and history recording are enabled, supported posts actually visible on X are recorded without a dwell delay, even without an available API Key or completed analysis. It stores canonical post URLs/IDs, displayed text (up to 12,000 characters), author labels, language, media-presence flags, first/latest viewing times and visit counts. Available generated answers (up to 30,000 characters), up to 20 safe source links, model/Token metadata and up to three comment drafts can be retained with a post. Protected or non-public posts can be included. This is not a full post archive; it does not save image files or retrieve unseen post text just to populate history.

History stays on the device and is neither uploaded as a history collection nor synced. Viewing, searching or expanding saved answers makes no API requests and does not automatically fetch remote images. Original-post and source links open their websites only when clicked. History is not an API-response reuse cache: viewing it does not resume generation. Entries are merged by post ID and ordered by the latest view. Viewing a post again restarts its 24-hour period; reaching the count or byte limits may remove older entries sooner.

Remember Key encrypts your API Key with AES-GCM and a random local encryption key. The ciphertext and encryption key are stored separately: ciphertext in `chrome.storage.local`, and the non-extractable CryptoKey in the extension’s IndexedDB. On browser startup, the worker automatically decrypts the saved Key into restricted session storage. There is no SuperX password, lock or unlock step. With Remember Key disabled, a new browser session requires entering the API Key again.

Settings, Keys and history are not stored through browser sync. Settings, custom prompts and browsing history are not encrypted; avoid placing credentials or private material in prompts. Automatic encryption protects a saved Key if only its ciphertext or local-settings storage is exposed. It does not protect against access to both ciphertext and extension IndexedDB, the full browser profile, backups containing those records, or a compromised runtime or device. Non-extractable means Web Crypto cannot export the CryptoKey; it does not bind the key to operating-system credentials or hardware. Storage is restricted to trusted extension contexts: the worker and extension UI can access the decrypted API Key and saved history; the feed content script receives public configuration and Key readiness, not the Key or saved history collection.

An upgrade can reuse an existing valid plaintext local Key or an available session Key from an older version. When Remember Key is selected, it encrypts that Key before removing the plaintext record. With session-only storage selected, persistent Key records and the local encryption key are removed. If the saved ciphertext or encryption key is missing or damaged, enter the API Key once again. The current version does not decrypt older password-encrypted records; obsolete records remain only until successful migration, replacement or clearing. Obsolete data-consent fields are ignored and do not control analysis.

## Expiry, clearing and controls

- **Pause / disable:** stops automatic analysis and new history recording. It does not delete the Key, cache or existing history. Cancellation can occur after a request has reached xAI, and already sent work may still be billed.
- **Collapse:** cancels waiting work and restores X's sidebar. Already started work may finish; collapse is not equivalent to clearing credentials or pausing all requests.
- **Clear saved Key:** cancels tasks and removes saved ciphertext, the separate IndexedDB encryption key, obsolete Key records, the session credential and session cache. Your remember preference remains selected or unselected as before. It does not delete browsing history, revoke the Key at xAI or erase an already sent request.
- **Replace Key:** cancels old tasks and clears the previous session cache before applying the replacement Key. Existing browsing history remains. Already sent work may still be billed.
- **Clear cache:** removes the session result cache and any legacy local cache. It does not erase your Key, settings, browsing history, provider records or answers already displayed in an open page; refresh that page to clear its displayed results. New completed requests can subsequently create new cache entries.
- **History controls:** turn off Save browsing history to stop new records and answer updates while retaining existing records until expiry. Delete removes one saved post and its answer/comment copies; Clear history removes all saved history. These controls do not delete the Key, session cache or provider records, or an answer displayed in X. A later actual view may create a new record while recording remains enabled.
- **Uncheck Remember Key and save:** removes saved ciphertext, the IndexedDB encryption key and obsolete persistent Key records, and keeps the current API Key only in session storage. Existing session-only credentials are not automatically migrated to persistent storage without choosing Remember Key.

Clearing extension records is not a guarantee of forensic erasure from the device, older backups or browser storage remnants.

The cache's 24-hour period is a **reuse expiry**, not a wall-clock deletion timer within an open browser session. Expired, malformed, future-dated or over-budget cache entries are pruned when the background worker initializes and when new entries are saved. Cache data can remain in session memory until that cleanup, explicit clearing or the end of the browser session. Closing X alone does not clear the session cache.

History's separate 24-hour lifetime runs from the post's latest view. Expired entries are excluded from history views and removed on startup, history reads/writes and an hourly `alarms` cleanup. Browser shutdown, scheduling delays and storage errors may postpone physical deletion; a timer does not guarantee exact-time erasure. History persists across browser restart until expiry or removal and can be pruned earlier to meet storage limits. Uninstalling or removing extension data through the browser is a broader removal step; provider records are separate.

If a storage write fails, session cleanup can be delayed. Expired entries still remain excluded from reuse in worker memory, and a later cache write retries without preventing the extension from starting. Removal of a legacy local cache can also fail and should be retried by reopening the extension or clearing its data.

There is no extension-level monetary budget or post-count cap. All visible eligible posts can trigger paid work. Keep automatic analysis paused until you have configured the Key and reviewed API billing.

## Permissions

| Permission | Why it is used |
| --- | --- |
| `storage` | Local settings, optional encrypted API Key, recent browsing history, restricted session Key and result cache |
| `alarms` | Periodic removal of expired local browsing-history records; no scheduled paid requests |
| `https://x.com/*`, `https://twitter.com/*` | Observe supported post elements, follow theme / language and show the result column |
| `https://api.x.ai/*` | Call the provider from the background worker |

The extension does not request the browser's `cookies` or `history` permission or broad access to all websites. Its own recent history comes from visible supported X post elements, not the browser's global browsing-history database. Matching a site for content-script injection is broader than the actual supported analysis paths; the runtime excludes direct messages and standalone Grok / settings flows.

## Reports and development

Tests and local UI previews use simulated browser APIs and credentials. They do not read the installed extension's real Key or perform paid analysis. Screenshots, console captures and issue reports can still expose private content: redact Keys, account details, protected posts and request payloads before sharing. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.

Changes to collected fields, host access, storage or provider calls require this document to be updated alongside the code.

Public support uses [SuperX Issues](https://github.com/bwjoke/SuperX/issues); sensitive security reports follow [SECURITY.md](SECURITY.md). The website's privacy address is [superx.vip/privacy/](https://superx.vip/privacy/). The hosted page, included notice and this source document describe the same extension behavior. Publication and accessibility of the website page are checked separately from local documentation changes.
