# Release checklist

This checklist separates reproducible checks from manual browser and service checks. A passing mock test suite is not evidence that a particular X account, browser installation, or paid API request works.

## 0.9.12 Stable promotion — 2026-10-20

[Stable release](https://github.com/bwjoke/SuperX/releases/tag/v0.9.12) · [Installable ZIP](https://github.com/bwjoke/SuperX/releases/download/v0.9.12/SuperX.zip) · [Chrome Web Store](https://chromewebstore.google.com/detail/superx/clcflilaihhnnglfamdblhopokpnlioo). This repair keeps X's inline reply toolbar out of primary-navigation detection and updates rail geometry when native navigation changes height. First published as Preview on October 19, it became Chrome Web Store and GitHub **Stable/Latest** on October 20. The layout checks below belong to the October 19 installed candidate.

- [x] Pass **263 content regressions** and **1,082 automated validation checks**, including inline reply controls, real navigation, hidden/duplicate tabs, temporary zero/oversized navigation, observation cleanup and preserved existing answers.
- [x] Pass **912 isolated browser checks across 12 scenarios with 38 screenshots**, covering the layout repair. These do not establish new live provider or installed-browser account acceptance.
- [x] Validate exported public source with **1,082 checks** and rebuild the installation ZIP with identical bytes.
- [x] After the user reloaded the extension, exercise actual installed **Windows Chrome 0.9.12**: focus the inline reply editor, scroll away and back, open an image, and open/close the new-post dialog. The rail returns correctly and the four existing completed answers remain available.
- [x] Record the accepted installation ZIP SHA-256: `c34d378b2eb37660a0d029c0e2c36b2dd4077a3548413a5a9b35ca55d293c885`. The versioned ZIP and `SuperX.zip` alias must have identical bytes.
- [x] The maintainer confirmed store publication. A direct request to the public listing and the Google-delivered CRX both report **0.9.12** on October 20.
- [x] Compare the delivered CRX with the accepted installation ZIP: **49 ordinary files byte-identical**, only Google's `update_url` added to the manifest, and only `_metadata/verified_contents.json` added. CRX SHA-256: `2b96c5b4ff1b4043d7f4cc236e7d0230ce1ba5748ef30b724ba367a186ba1386`. This is a payload comparison, not installation or independent CRX-signature verification.
- [x] Promote the same GitHub release to Stable/Latest without moving its tag or replacing its seven attachments. Preserve all published 0.9.11 files as historical artifacts.
- [ ] Complete a new store-installed functional test separately; public availability and payload comparison do not establish that pass.

This is targeted layout acceptance. It does not add evidence for the earlier pending four-scope full-browser restart, natural token expiry, installed Edge/macOS operation or new live API Key/CLI acceptance. Those scopes remain as recorded below.

<a id="0911-preview--2026-10-18"></a>

## 0.9.11 Stable promotion — 2026-10-19

[Archived release](https://github.com/bwjoke/SuperX/releases/tag/v0.9.11) · [Installable ZIP](https://github.com/bwjoke/SuperX/releases/download/v0.9.11/SuperX.zip). The official listing reported **0.9.11** on **October 19, 2026**. That release was promoted from Preview to **Stable/Latest** by changing status only; its tag, attachments and hashes were preserved. Version 0.9.12 superseded it on October 20; both 0.9.11 and 0.7.26 remain historical archives.

The functional evidence below was collected on October 18 from the installed Windows Chrome candidate. Store publication is a distribution result, not a new store-installed functional pass or evidence for pending browsers, restart or expiry scenarios.

- [x] Run the current automated validation: **1,057 tests passed**. These use controlled browser/provider fixtures and do not establish live account eligibility or billing.
- [x] Complete **16 isolated Edge Manifest V3 locale-selection checks**, covering packaged metadata language selection. This is isolated browser coverage, not acceptance of the installed extension on a real Edge account.
- [x] Verify the current four-scope request omits profile/email; keep existing connected grants and reject unfinished authorizations from the retired scope set. Do not claim existing grants were retroactively reduced.
- [x] Record fresh user-approved four-scope sign-in in installed Windows Chrome and the earlier live Grok 4.3 Fact Check with four clickable sources (23,754 reported Tokens).
- [x] After the latest extension reload and X refresh, retain the four-scope login and complete a new live **Grok 4.3 Fact Check: 30,226 Tokens (29,693 input / 533 output), six distinct citation sources**.
- [x] Generate exactly **three comment drafts: 1,373 Tokens (1,305 input / 68 output)** in the current four-scope run.
- [x] User-confirmed live tab switch: leave while generation is running, return and see the same task continue without another request.
- [x] Click a comment copy button and observe **Copied** feedback after the clipboard write resolved. Independent system-clipboard readback was not verified.
- [ ] Complete four-scope **full Chrome exit/reopen** restoration and a new uncached check; extension reload/refresh is a different scenario.
- [ ] Observe real natural access-token expiry and safe refresh/reauthorization behavior. Simulated expiry is not a live-expiry pass.
- [ ] Complete installed Edge and macOS acceptance; repeat official CLI / ACP installation and inference with real accounts on Windows/macOS. New live API Key inference has not been established by this run.
- [x] Prepare versioned Stable downloads, three-source installation notes, updated privacy guidance, bounded-retry behavior and [PR #1 community credit](https://github.com/bwjoke/SuperX/pull/1), accurately identifying the independent implementation.
- [x] Preserve the original tagged source commit `151985851dd6555e62864b9f2fb6d2568e9b4d77`, installation ZIP SHA-256 `cc77b5b1c3f2aa0fcc679127f53003ceac562f3b35ba54af14ec34761d1789bc` and source ZIP SHA-256 `62064c03dacfe4f62209871ca837be180160d2a271946430be0b195a5f17f89e`. The original [CI](https://github.com/bwjoke/SuperX/actions/runs/39127074307) and [release workflow](https://github.com/bwjoke/SuperX/actions/runs/39127074254) passed; all seven release attachments were anonymously verified. This promotion does not replace them or the historical 0.7.26 artifacts.
- [x] Verify the official public Chrome Web Store listing reports **0.9.11**, updated **2026-10-19**, for item `clcflilaihhnnglfamdblhopokpnlioo`.
- [x] Compare the Google HTTPS-delivered 0.9.11 CRX against the accepted ZIP: **51 versus 50 files**, **49 ordinary files byte-identical**, only Google `update_url` added semantically to the manifest, and only `_metadata/verified_contents.json` added. No manifest key or other semantic change was found. CRX SHA-256: `80abbbe205bb8664639fdc8771167ab7bd5f191d351aac5ad678f10788a3873d`. CRX and ZIP whole-package hashes differ by format; this comparison did not install the CRX or independently verify its signature.
- [x] Promote the existing GitHub 0.9.11 release to Stable/Latest and verify the anonymous Latest ZIP. The download matches SHA-256 `cc77b5b1c3f2aa0fcc679127f53003ceac562f3b35ba54af14ec34761d1789bc`; the original tag and all seven attachment digests remain unchanged.
- [ ] Complete a new store-installed functional test separately; listing availability and file comparison do not establish that pass.

The earlier six-scope authorization used `openid profile email offline_access grok-cli:access api:access` and separately passed live checks, three comments/copying, cross-tab cache reuse and new uncached checks after fully restarting Chrome. The current flow requests only `openid offline_access grok-cli:access api:access`. Those six-scope results do **not** prove current four-scope restart restoration or expiry. Current observations also do not establish all-plan eligibility, Included billing treatment or captured raw native-annotation protocol behavior. Exact evidence and remaining limits are in [CONNECTIONS.md](CONNECTIONS.md#acceptance-scope).

## Historical development snapshots

The following 0.8.x/0.9.1 entries record earlier local candidates, not separately published releases or the current acceptance checklist. The combined 0.9.11 release supersedes their current-status wording; keep historical passes and pending evidence scoped to their original builds.

## 0.9.1 local candidate — official connection, Windows and macOS

- [x] Implement independent API Key and direct official Grok CLI / ACP modes; preserve API defaults and avoid automatic provider fallback or paid retry.
- [x] Provide Dashboard Key setup and a built-in Windows/macOS official-install, login, generated-command and connection-check guide. No extra SuperX program or downloaded profile file is required.
- [x] Remove native-messaging permission and obsolete local-program packaging. Scope optional local access to 127.0.0.1; encrypt the local connection code and exclude it from public configuration and diagnostics.
- [x] Exercise model/effort negotiation, login-required states, actual tool-count gates, reverse-RPC denial, hosted search events, usage retention, per-post sessions, cancellation and unconfirmed cleanup with controlled fixtures.
- [ ] Install the candidate on Windows Chrome / Edge with official Grok and a real account; verify guided setup, Fact Check, comments, language following, model/effort choices, cancellation, restart and recovery.
- [ ] Repeat installed-browser acceptance on Apple silicon and Intel Macs, including official installation, terminal startup, local permission, login/restart and stopping the service. Simulated Mac paths are not a live-device pass.
- [ ] Review managed-device limitations with actual device policy before claiming support there; do not remove or bypass company policy.
- [ ] Accept the candidate, then explicitly publish Preview. Store submission, website update and Stable promotion remain separate. Preserve all published 0.7.26 artifacts and earlier local snapshots.

## 0.8.2 local candidate — Model and reasoning selectors

- [x] Replace free-form model entry with a model selector and a supported-effort selector. Preserve old saved model IDs and their previous effective reasoning defaults.
- [x] Apply the chosen effort to fact checks and comment drafts; separate their caches by effort and refresh old displayed results when the saved effort changes.
- [x] Complete local automated and isolated-browser checks for model/effort choices, save/reopen, language changes, Key drafts, fast defaults and narrow layouts: 647 automated tests and 166 isolated-browser checks passed. No real Key or paid API request was used.
- [ ] Confirm the installed candidate on real X; model availability, provider behavior and factual accuracy still require live acceptance.
- [ ] Publish only after explicit candidate acceptance. Keep the published 0.7.26 Stable artifacts unchanged.

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

## Historical 0.7.26 installed-browser checklist

The pass labels below belong to the 0.7.26 acceptance recorded above; they are not new 0.9.11 checks. For each new release, repeat applicable scenarios in a fresh browser profile and separately as an upgrade, using that release's connections and Fact Check behavior. A Pending entry was not established by the historical core check even if a fixture covers it. Enter credentials yourself in extension Settings; never include them in an issue, screenshot, recording or test fixture.

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

For current live acceptance, use a small, controlled session to verify the selected connection, model and tools. Automatic Fact Check makes one generation request per attempt, without a preceding explanation or second background check. Comment drafts use a separate request; tool calls and retries can add usage. All visible posts can trigger requests, including started work that continues after switching tabs. Disable new analysis when the check ends and account for already-started work. Entitlement, allowance and charges follow the provider account, not mock-test results.

## Failure and privacy checks

Use isolated fixtures for rate limits, interrupted streams, incomplete Fact Checks, invalid credentials and cancellation; do not deliberately exhaust a real account. Preserve partial findings, citations and reported usage, show safe diagnostics and keep one failure from freezing other posts. API Key/local CLI transient failures wait 3 seconds and retry up to 5 additional times; waiting retries release their slots and rejoin the queue after actual transport cleanup. Invalid credentials, account restrictions, unsupported settings, output limits and unconfirmed local cancellation are terminal. OAuth does not automatically replay generation after an accepted HTTP 200, stream failure, incomplete output or timeout; an initial HTTP 401 rejection may refresh once and make one recovery request. Verify bounded attempts, usage aggregation and no duplicate request when returning to a tab or remounting a post. Page navigation/closure/BFCache still safely stop interrupted work and leave manual retry available.

Verify startup pruning removes expired session-cache entries while valid answers remain reusable. Credential/source changes must not restore an older Key, OAuth grant or cached result from a late operation; OAuth generated results stay separated by authorization identity. Confirm retired consent fields do not block an upgrade. With fabricated credentials, check automatic remembered-credential encryption, a separate non-extractable IndexedDB key and failure-safe migration/persistence. Remember-off and sign-out must remove the appropriate persistent login without clearing unrelated sources or pretending to erase existing provider-side work. History text remains local and unencrypted; do not claim full-profile protection, hardware binding or guaranteed forensic erasure.

## Release procedure

Use the shared [release channels](RELEASE_CHANNELS.md) procedure. GitHub hosts previews and stable archives; the store distributes accepted stable versions from the same source and package.

1. Keep `package.json` and `extension/manifest.json` on the same version.
2. Complete local checks, build `npm run package:release`, and review the exact Git diff and both archive inventories. Record the commit and installation ZIP SHA-256.
3. Push the reviewed source and version tag only after publication is authorized.
4. The release workflow validates the numeric tag, reruns tests, and attaches the installation/source ZIPs, inventories and checksums to a draft preview excluded from Latest.
5. Complete public-distribution prerequisites, review the draft, and explicitly publish it as a Pre-release with installation notes and known limitations.
6. Complete browser acceptance for a chosen candidate. Verify its published installation ZIP checksum and upload that exact package to the store. Keep its GitHub status Preview during review.
7. Once the same version is actually available from the store, verify it and promote the existing GitHub release to Stable/Latest without replacing attachments or moving its tag. Update the channel entries and release report together.

- [x] Record the public store item ID and listing URL. The October 8 entry records historical 0.7.26 publication; the October 19 section records current 0.9.11 publication.
- [x] Confirm the stable `SuperX.zip` alias has the same bytes as the versioned ZIP, is included in its checksums and is available through `/releases/latest/download/SuperX.zip`.
- [x] Keep Preview separate from Stable/Latest. Version 0.9.11 was Preview on October 18 and promoted on October 19; current download entries use Stable/Latest and no longer list the same version as a new Preview.
- [ ] Check that store support points to the repository's public Issues and privacy links use the verified public policy URL.
- [ ] Keep manual update and channel-switch instructions accurate; do not promise automatic Key/settings migration across installation IDs.

GitHub repository/release publication, website deployment and browser-store submission are separate steps. Local preparation does not establish their public status.
