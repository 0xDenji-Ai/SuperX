# Release checklist

This checklist separates reproducible checks from manual browser and service checks. A passing mock test suite is not evidence that a particular X account, browser installation, or paid API request works.

## 0.8.1 local candidate — Fact Check only and reader output handling

- [x] Remove live explanation generation and the explanation/settings flow selector; each automatic task makes one streamed Fact Check request.
- [x] Apply concise, non-repetitive fact-check instructions in built-in and custom modes; keep the original URL and full-post retrieval as context.
- [x] Migrate retired flow settings to Fact Check only, preserve saved credentials and valid custom drafts, and partition new answers from 0.7.26 explanation-plus-check caches.
- [x] Keep existing browsing history readable, including older answers. Preserve comment drafts, independent language choices and Token/model details.
- [x] Validate intermediate-message and tool-command regressions locally: split streaming prefixes, final-answer replacement, no final answer, partial failures, cache/history boundaries and ordinary JSON/code preservation. The 0.8.1 candidate passes 629 automated tests and 95 isolated local-browser checks; these do not call the paid API or prove live-provider acceptance.
- [ ] Confirm the installed 0.8.1 candidate on real X posts: no tool-command JSON in answers, incomplete status when no final answer arrives, no explanation step, useful concise findings rather than a post recap, Auto original/translation following, custom prompts, comments and Key restoration.
- [ ] Explicitly publish a new GitHub Preview after candidate acceptance; keep the existing 0.7.26 Stable tag and attachments unchanged. Store submission and Stable promotion remain separate.

The 0.8.1 source and local package are candidates. The 0.8.0 candidate remains an earlier local snapshot. The published Chrome Web Store and GitHub Stable/Latest remain 0.7.26 until a later release is deliberately published and accepted. Local mock regressions do not establish the exact upstream event shape of an observed live failure.

## Before the first GitHub Preview

- [x] Review and publish the first public Git commit: no credentials, browser profiles, private screenshots, workstation paths, temporary SDKs or unrelated production files. The independently maintained website and internal store-preparation files are excluded. The `v0.7.26` release contains 76 public source files.
- [x] Enable GitHub private vulnerability reporting and confirm the process in `SECURITY.md`; the repository API reports it enabled.
- [x] Review the English and Chinese README installation steps and configured release/support URLs. The initial Preview download and Issues were publicly available; 0.7.26 is now available through the store and GitHub Stable/Latest as recorded below.
- [x] Run local validation: 642 automated tests passed. Validate and package the exported public source separately; its installation ZIP matches the working-source build byte for byte.
- [x] Confirm the installation ZIP has `manifest.json` at its root, includes project and Marked license notices, and matches the generated inventory and SHA-256 checksums.
- [x] Review release notes, privacy documentation and API billing information; verify the independently hosted privacy page separately.
- [x] Complete the Chrome core acceptance recorded below for 0.7.26; disclose remaining browser and advanced manual checks in the Preview notes.
- [x] Publish the actual policy at `https://superx.vip/privacy/` through the existing website deployment, with the public Issues link. Anonymous HTTP checks confirm the distinct bilingual privacy content and its local assets; the homepage, download and support destinations work.
- [x] Publish the reviewed repository and Preview after authorization. Anonymous download matches the accepted installation ZIP SHA-256: `23711b6b3349428ad7374e4e409a8a96241794f1820889f7dfdbf3d0e15040b2`.
- [x] Confirm GitHub CI and the release workflow on the published source: both completed successfully for release commit `254cade96e210e3faef4ca7e08fb67f6bc8c8e90`.

The first Preview uses the completed Chrome core checks plus local validation. It does not require every Edge or advanced manual scenario below to be complete. Keep untested scenarios explicit; a Preview is not Stable or store approval.

## 0.7.26 store publication and remaining checks — 2026-10-08

- [x] Verify the public [Chrome Web Store listing](https://chromewebstore.google.com/detail/superx/clcflilaihhnnglfamdblhopokpnlioo), item ID `clcflilaihhnnglfamdblhopokpnlioo`, and version 0.7.26.
- [x] Compare the delivered CRX with the accepted GitHub ZIP: 30 versus 29 files, all non-manifest files byte-identical, only store verification metadata added, and the manifest differs only by `update_url`. This is a file-content comparison, not a claim that CRX and ZIP hashes match.
- [x] Confirm actual Chrome store installation with the user: explanations, Fact Check, Key saving and restoration after restart work.
- [x] Promote the existing 0.7.26 GitHub release to Stable/Latest and verify the anonymous latest ZIP download. Preserve the tag, installation/source attachments and accepted installation SHA-256.

Stable records the completed Chrome publishing and core functional checks. It does not turn the remaining scenarios below into passes or guarantee model accuracy.

- [ ] Complete the remaining installed-browser acceptance for the supported release scope, including Edge and advanced credential/storage scenarios below. Record any unsupported or deferred scope explicitly.
- [ ] Match the Chrome Web Store privacy declarations to the actual website content, post URLs, author labels and API credential handling. No remote executable code is used.
- [ ] Review provider and store data-handling requirements against the final simplified setup; removing the consent UI does not establish store approval or an exemption from provider terms. Provide usable review credentials only through the dashboard's private review fields.

## 0.7.26 Chrome core acceptance — 2026-10-07

The user confirmed the following on installed Chrome on Windows 11. These are user-reported functional results; they do not certify every storage detail or every browser. The exact Chrome build number has not been recorded.

| Scenario | Result |
| --- | --- |
| Upgrade the existing Chrome installation; normal operation | User-confirmed pass |
| Restart Windows 11; remembered Key restores without re-entry | User-confirmed pass |
| Fresh Chrome profile: Enable and Remember Key on; both language choices Auto | User-confirmed pass |
| No API Key: local browsing history works | User-confirmed pass |
| First save of the user's own API Key; explanation and Fact Check produce results | User-confirmed pass |
| Answer language and interface language can be switched independently | User-confirmed pass |
| Auto answer language follows original / translation switches | User-confirmed pass |
| Generate three comments and copy a suggestion into Notepad | User-confirmed pass |

Edge's actual installed-extension checks remain pending. Successful Key restoration does not mean the user inspected ciphertext, IndexedDB, old-format migration or failure races; those scenarios retain their separate evidence and pending manual status.

The user separately confirmed the store-installed 0.7.26 on 2026-10-08: installation, explanation, Fact Check, Key saving and restart restoration passed. This confirmation does not extend the earlier language, clipboard or history checks to a new store-installation test.

## Detailed installed-browser checks

Complete each scenario in a fresh browser profile, separately from an upgrade of an existing installation. A Pending entry has not been established by the core check above, even if an automated fixture covers it. Enter API credentials yourself in the extension settings; never include them in an issue, screenshot, recording, or test fixture.

| Check | Chrome | Edge |
| --- | --- | --- |
| Record browser version and operating system | Pending | Pending |
| Extract the release ZIP and load its root folder in Developer mode | Pending | Pending |
| Open settings before visiting X; interface follows browser language | Pending | Pending |
| Fresh-profile defaults: Enable and Remember Key on; both languages Auto | User-confirmed pass | Pending |
| Save and reopen settings; choices remain | Pending | Pending |
| First save of an own Key allows enabled explanation and Fact Check | User-confirmed pass | Pending |
| Install 0.7.26 from the Chrome Web Store; explanation and Fact Check work | User-confirmed pass (2026-10-08) | Pending |
| Store-installed Key saves and restores after restart | User-confirmed pass (2026-10-08) | Pending |
| No API requests without a usable Key; inspect the no-Key failure path | Pending | Pending |
| Remembered Key restores after Windows/browser restart without re-entry | User-confirmed pass (Windows reboot) | Pending |
| Inspect saved ciphertext, absence of a plaintext local API Key and the separate IndexedDB encryption key | Pending | Pending |
| Session-only Key is unavailable after browser restart and requires re-entry | Pending | Pending |
| Upgrade: encrypt existing plaintext or a usable old session Key before removing old records; unavailable old password-encrypted Key requires one-time API Key re-entry | Pending | Pending |
| Missing/damaged ciphertext or IndexedDB encryption key requests API Key re-entry, never authorizes a paid call | Pending | Pending |
| Clear or replace Key: cancel queued analysis/comments/fact checks and clear obsolete credentials/cache | Pending | Pending |
| Settings opens at the API Key field for missing or migration-needed credentials; no password, lock or unlock controls | Pending | Pending |
| Cache is reused within the browser session and removed on browser exit; legacy local cache is deleted | Pending | Pending |
| Uncheck Remember Key; verify the choice survives browser restart and ciphertext, IndexedDB encryption key and obsolete persistent records are removed | Pending | Pending |
| Clear Key; ciphertext, IndexedDB encryption key, old records, session Key and cache clear while the selected preference remains | Pending | Pending |
| Upgrade to the candidate; normal operation | User-confirmed pass | Pending |
| Upgrade preserves each saved prompt/setting; inspect the migration paths | Pending | Pending |
| Check popup pause/resume and opening settings | Pending | Pending |
| Auto interface labels follow an X interface-language change | Pending | Pending |
| Answer and interface language selections switch independently | User-confirmed pass | Pending |
| Auto answer follows original/translation; fixed answer language can be selected | User-confirmed pass | Pending |
| Collapse/expand; left navigation and timeline do not resize | Pending | Pending |
| Review Markdown, source links, and model/Token tooltip | Pending | Pending |
| Generate three one-line comments and copy one into Notepad | User-confirmed pass | Pending |
| Browsing history records visible supported posts with no Key | User-confirmed pass | Pending |
| History merges repeat views, survives restart and makes no paid request when opened | Pending | Pending |
| History search, individual deletion, clear and recording toggle work independently of the Key and result cache | Pending | Pending |
| Start a request, pause or navigate away; late output does not attach to another post | Pending | Pending |

Use a small, controlled live session to verify the user's configured model and API access. All visible posts can trigger paid requests; background fact-checking can add another request per post. Disable analysis when the check ends. Live API access and charges are controlled by the user's xAI account, not by mock tests.

## Failure and privacy checks

Use isolated fixtures to reproduce a rate limit, interrupted stream, fact-check failure, and invalid Key; do not deliberately exhaust a real account's quota. Confirm explanation preservation, safe diagnostic messages, no automatic paid retry, and cancellation handling. Verify startup pruning removes expired cache entries from session storage, while valid answers remain reusable. Check credential changes cannot restore a Key or cached result from an older asynchronous operation. Confirm obsolete consent fields do not block an upgrade or return through saved settings. Use fabricated credentials to confirm that local extension storage contains no plaintext API Key after a successful remembered save, random AES-GCM encryption uses a separate non-extractable IndexedDB key, and failed encryption or migration does not report success or remove an unmigrated plaintext credential. Verify the privacy notice does not claim full-profile protection, hardware binding or guaranteed forensic erasure.

## Release procedure

Use the shared [release channels](RELEASE_CHANNELS.md) procedure. GitHub hosts previews and stable archives; the store distributes accepted stable versions from the same source and package.

1. Keep `package.json` and `extension/manifest.json` on the same version.
2. Complete local checks, build `npm run package:release`, and review the exact Git diff and both archive inventories. Record the commit and installation ZIP SHA-256.
3. Push the reviewed source and version tag only after publication is authorized.
4. The release workflow validates the numeric tag, reruns tests, and attaches the installation/source ZIPs, inventories and checksums to a draft preview excluded from Latest.
5. Complete public-distribution prerequisites, review the draft, and explicitly publish it as a Pre-release with installation notes and known limitations.
6. Complete browser acceptance for a chosen candidate. Verify its published installation ZIP checksum and upload that exact package to the store. Keep its GitHub status Preview during review.
7. Once the same version is actually available from the store, verify it and promote the existing GitHub release to Stable/Latest without replacing attachments or moving its tag. Update the channel entries and release report together.

- [x] Record the public store item ID, version 0.7.26 and actual listing URL; the page is published, not merely approved.
- [x] Confirm the stable `SuperX.zip` alias has the same bytes as the versioned ZIP, is included in its checksums and is available through `/releases/latest/download/SuperX.zip`.
- [x] Keep the Preview entry on the Releases list separately from Stable/Latest. No newer Preview is available at this promotion.
- [ ] Check that store support points to the repository's public Issues and privacy links use the verified public policy URL.
- [ ] Keep manual update and channel-switch instructions accurate; do not promise automatic Key/settings migration across installation IDs.

GitHub repository/release publication, website deployment and browser-store submission are separate steps. Local preparation does not establish their public status.
