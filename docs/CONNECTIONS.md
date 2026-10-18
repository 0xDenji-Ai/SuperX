# Connect SuperX

The unreleased **0.9.11** candidate offers three independent connections. **Grok API Key** remains the default; **Grok subscription (OAuth)** signs in entirely in the browser; **Grok CLI / ACP** connects to the official Grok service on your computer. All three initially select **Grok 4.3 / reasoning None** and retain their own choices. Existing API and local configurations are preserved. Switching sources never substitutes another credential, changes account budgets or bypasses quotas. Published Stable remains **0.7.26** and supports API Key mode.

| Connection | What you need | Where you sign in / manage usage |
| --- | --- | --- |
| Grok subscription (OAuth) | An eligible Grok account and a browser | Official xAI device-authorization page; your Grok account |
| Grok API Key | A Grok Inference Key or xAI Console API Key | Grok Dashboard for subscription allowance, or xAI Console for pay-as-you-go usage |
| Grok CLI / ACP | Official Grok installed, signed in and running locally | Official CLI login and account; SuperX connects only to its loopback service |

## Grok subscription (OAuth) — browser only

This candidate connects directly from Chrome / Edge on Windows or macOS. **No Grok CLI, terminal, additional SuperX program or API Key is required.**

1. Open **Settings → Connection**, select **Grok subscription (OAuth)** and choose **Sign in to Grok**.
2. SuperX displays a short authorization code and opens the official `accounts.x.ai` / `auth.x.ai` device page. Check that the code matches and confirm the requested access yourself. Enter your account password only on the official site, never in SuperX.
3. Return to SuperX. After authorization, it loads the account's model directory without sending a Fact Check, comment or other test inference request. If the page was closed, reopen the official link from Settings before the code expires; otherwise cancel and start again.
4. Select a model available to this account and a supported reasoning level, then save settings and enable SuperX. The initial choice stays **Grok 4.3 / None**; an unavailable choice is shown explicitly rather than silently replaced by Grok 4.7.

**Why the official page may say Grok Build:** SuperX currently uses xAI's shared public OAuth client, not a separately registered SuperX client. [OpenClaw's xAI documentation](https://docs.openclaw.ai/providers/xai) documents the same shared-client identity and [its implementation](https://github.com/openclaw/openclaw/blob/main/extensions/xai/xai-oauth.ts) provides a public reference. This does not make SuperX an official partner or establish support for every plan. Eligibility, available models, tool access, limits and charges follow your account and the provider's current rules.

**Remember login on this device** defaults on. SuperX encrypts the rotating refresh token locally with a separate AES-GCM key in extension IndexedDB. Access tokens remain only in restricted browser-session storage and worker memory. No SuperX password, browser sync, CLI login file or project relay is used. With remembering off, the login lasts only for this browser session. Expiry follows the provider's returned token lifetime, with background and on-demand refresh. A missing/corrupt record, uncertain rotation or failed rotated-token save requires a new login rather than reusing a possibly consumed refresh token.

**Sign out** removes this OAuth connection and attempts to revoke the most recently known refresh token at the provider. It does not log out of your browser's Grok website, stop the CLI, erase recorded post visits, or clear saved API/local credentials. Revocation is best effort; provider-side records and account controls remain separate. Changing connection source cancels a pending device login; it does not automatically sign out an already connected OAuth account.

The extension requests the additional fixed host `https://auth.x.ai/*` for device authorization, token refresh and revocation; an upgrade may require Chrome to approve this new site access. Generation and model-directory calls still go directly to `https://api.x.ai`, using OAuth Bearer authorization without CLI identity headers. The public configuration uses client ID `b1a00492-073a-47ea-816f-4c329264a828` and scopes `openid profile email offline_access grok-cli:access api:access`; these are application identifiers, not credentials. SuperX does not request a user-info profile or collect your email from it. See [Privacy](../PRIVACY.md) for local storage, isolation and network details.

OAuth generation is not automatically replayed after an accepted HTTP 200 response, an in-stream failure, incomplete output or timeout. An initial HTTP 401 rejection can refresh authorization once and make one recovery request; a second rejection requires sign-in again. Retained partial output and reported usage stay visible, while other posts continue through the shared queue. Check the error before choosing **Reanalyze** yourself.

## Grok API Key

This browser-only option works on both Windows and macOS. No terminal or extra local software is required.

1. Open SuperX **Settings → Connection**, select **Grok API Key**, and expand **Get a Grok API Key or check usage** if needed.
2. Choose the appropriate account site: for eligible The X Subscription API allowance, use [Grok Dashboard → API Keys](https://grok.com/dashboard/api-keys), choose **Grok Inference** instead of **Cursor**, and enable **Chat** / the required model permissions. For pay-as-you-go API credits, create a Key and add credits in [xAI Console](https://console.x.ai/). Both Keys go in the same SuperX input; there is no additional provider or Key-source selection.
3. Create a Key, paste it into SuperX, and save. **Remember Key on this device** is selected by default and restores it after browser restart without a SuperX password.
4. Select an available model and reasoning effort. Enable SuperX and open X.

Entitlement, usage limits and charges depend on your account and the provider's rules. Check [Grok Dashboard usage](https://grok.com/dashboard/usage) for subscription usage, or xAI Console for pay-as-you-go usage/billing. A subscription is not a promise of free or unlimited API usage, and saving a Key does not validate provider access or available allowance. See [Privacy](../PRIVACY.md) for data and credential handling.

Eligible API use from The X Subscription shares the plan's weekly allowance. For pay-as-you-go API use, create a Key and add credits in [xAI Console](https://console.x.ai/); tokens and tool calls are billed there. Purchasing standard credits does not automatically improve processing priority. [Priority Processing](https://docs.x.ai/developers/advanced-api-usage/priority-processing) requires explicit opt-in and extra payment; SuperX currently uses standard requests. Priority can reduce peak-time latency but does not guarantee availability.

## Grok CLI / ACP — official local connection

Use the official Grok installation and account login. **No separate SuperX installer, Node installation, browser host registration or downloaded profile file is required.** The browser communicates with the official CLI's ACP WebSocket service; it cannot start terminal programs by itself.

The guide covers **Windows PowerShell** and **macOS Terminal**, including Apple silicon and Intel Macs supported by the official Grok distribution. Use desktop Chrome or Chromium-based Edge 120+. This candidate checks compatibility with **Grok Build 1.0.60** before sending a task; another version is rejected until its protocol and restrictions are reviewed.

1. Follow the [official Grok installation instructions](https://github.com/xai-org/grok-build). Open PowerShell on Windows or Terminal on macOS. Run `grok --version` to check the installation, then `grok login` and finish signing in on the official page. SuperX does not ask for your account password or receive the login token.
2. Open **SuperX Settings → Grok CLI / ACP → Step-by-step guide**. Select Windows or macOS, then **Generate launch command**. SuperX creates a random local connection code automatically; you do not need to invent a password or edit configuration files.
3. Copy the generated command into that terminal and run it. It starts the official service on **127.0.0.1**, with an isolated temporary working/configuration directory and restricted discovery settings. Keep the terminal open while using this mode.
4. Return to SuperX and select **Check connection**. Approve the browser's optional access to the local address if asked. The check confirms the official login, protocol, available models and restricted session without sending a Fact Check or comment prompt.
5. **Save connection**, choose an available model and reasoning effort, and save settings. Enable SuperX and open X. Local settings initially select **Grok 4.3 / reasoning off (`none`)**, independently of API Key and OAuth choices. The local mode does not use your extension API Key. If the official CLI cannot confirm that model or reasoning level, SuperX keeps the choice visible and asks you to choose a supported option; it does not silently switch to Grok 4.7 or enable reasoning.

The former CLI default **Grok 4.7 / Low** is migrated once to **Grok 4.3 / None**. Older versions did not record whether that exact pair was chosen manually; other combinations and later explicit selections are retained. ACP `none` is a distinct level from `minimal` and `low` and must be confirmed by the official service before a prompt is sent.

For daily use, start the generated command before opening X. After restarting your computer, start it again; SuperX cannot automatically launch the official CLI. If you generate a new connection code, run the new command and save the new connection together. To stop the service, press **Ctrl+C** in its terminal. You can switch back to API Key mode at any time.

The service is bound to this computer, not the local network or a public relay. The connection code authorizes access to that local service. Keep it, the generated command and screenshots of either private. It is not your Grok account password or API Key. SuperX encrypts its saved copy locally and does not send it to X or a SuperX server. Local encryption does not protect a compromised device or full browser profile. Terminal history and your clipboard can retain a copied command; generating a new code and stopping the old service invalidates that old connection.

SuperX supplies a restricted profile for each new post session, checks that the actual local-function count is zero, refuses filesystem/terminal/permission requests and observes only the allowed hosted search events. The generated launch command also disables imported coding/MCP integrations. These are application restrictions, **not an operating-system sandbox** or a guarantee against a compromised official runtime. Do not replace the generated command with `--always-approve` or expose the service on `0.0.0.0`.

Closing a browser connection alone does not guarantee that an official-service task stops. SuperX explicitly requests cancellation and session closure; if it cannot confirm this, it reports the uncertainty instead of retrying. Press Ctrl+C in the service terminal if a stop cannot be confirmed. If the warning remains after the service has stopped, reload SuperX from Settings, then start and check the service again; the worker deliberately keeps an unresolved-session block until it can confirm cleanup or is reloaded. Already submitted work may count against provider usage. Official Grok can make supporting requests, such as generating session titles, in addition to the main task.

In all three connection modes, automatic analysis waits until feed/page scrolling stops and a post remains visible for the configured time: 1 second by default, adjustable from 0 to 30 seconds in Settings. Further scrolling resets pending work's timer; scrolling inside SuperX's answers does not. Zero starts immediately, and manual reanalysis/comments bypass the wait. API Key and OAuth share the configured request limit, default 3 (configurable from 1 to 8); local Grok tasks run serially with a fresh session per post. Neither ACP nor the selected reasoning effort guarantees lower latency or lower quota consumption. Reported Token counts are not a measurement of subscription cash charges.

Started answers and comments continue when their posts scroll out of view, including when X temporarily unmounts their articles. Returning restores the same task and partial output. Unstarted work can be withdrawn. API Key and CLI / ACP tasks retry transient failures after 3 seconds, up to 5 additional attempts, without pausing other posts. Waiting retries release their request slots and rejoin the shared queue only after local transport cleanup finishes. Reported usage accumulates across attempts; retries may consume additional provider allowance or paid API usage. Invalid credentials, account restrictions, output limits, unsupported settings and unconfirmed local cancellation do not automatically retry. OAuth uses the more conservative no-replay policy above. No retry changes the selected connection, model or reasoning level.

Generated cache entries and saved-history answers/comments are scoped to the selected connection source and, for OAuth, the individual authorization identity. Switching sources or OAuth accounts does not show another source/account's generated results. The local record of which posts you visited remains available; switching or signing out does not delete those visits.

## Troubleshooting

| Message or situation | Next step |
| --- | --- |
| `grok` is not found | Finish the official installation, then reopen PowerShell or Terminal so its PATH is updated. |
| Sign-in required | Run `grok login` outside the SuperX launch command, complete the official login and check again. |
| OAuth authorization expired / declined | Cancel and sign in again from Settings; approve only the code on the official page. No CLI login or API Key is needed. |
| OAuth refresh uncertain / storage error | Sign in again. SuperX will not reuse a potentially consumed refresh token or fall back to your API Key. |
| OAuth connected but model directory unavailable | Reload the model directory; this is separate from the login state. Keep the selected model until the account confirms availability. |
| Cannot connect | Keep the service terminal open. Check that its port and code match SuperX; stop any older service before starting a replacement. |
| Local permission denied | Allow SuperX's optional local-address access from the connection check. API mode does not need it. |
| Unsupported version | Compare `grok --version` with this candidate's tested version. Use API mode while a newer official runtime is awaiting compatibility review. |
| Model / effort unavailable | Select the choices reported by the connected account. API and CLI catalogs may differ; no model is silently substituted. |
| Restricted session could not be confirmed | Use the generated command. Managed-device policy may prevent this setup; do not disable company protections. API mode remains available. |
| Stop could not be confirmed | Press Ctrl+C in the official service terminal. SuperX does not replay the request automatically. |
| Usage / account limit | Check the matching account's usage and billing, then retry the affected post manually. This task does not automatically retry; other posts are not globally paused. Switching transport is not a quota workaround. |
| Rate limit / model busy / interrupted stream | API Key/local transient failures retry after 3 seconds, up to 5 times. OAuth does not replay accepted requests; inspect the retained error/partial output before a manual retry. Other posts continue. |

## Acceptance scope

On October 18, 2026, the installed 0.9.11 candidate was exercised in Windows Chrome with a fresh user-approved OAuth authorization:

- Live Grok 4.3 Fact Checks completed, with rendered evidence citations and clickable source links.
- A live result generated exactly three one-line comment drafts; clicking a draft displayed **Copied**.
- A separate tab reused a completed result and its tooltip identified the cache hit without new Token usage for that part.
- The user fully exited and reopened Chrome, confirmed that Settings remained connected without signing in again, and subsequent new, uncached Grok 4.3 checks completed. Cached answers alone were not used to establish restored generation.

The user confirmed that signing out returned the selected OAuth source to its sign-in guidance, did not silently use another source, and retained the saved API Key/Build configuration. This run did not add live API Key inference or a new CLI installation/inference acceptance. macOS installed-browser operation and actual natural token expiry were not tested. UI citation rendering was observed; raw native annotation protocol handling has automated coverage, not a captured live-protocol assertion. These results do not establish every subscription's eligibility, Included billing treatment or service availability.

Windows/macOS command generation, OAuth lifecycle and provider behavior also have automated coverage. Official CLI / ACP real-account installation and device acceptance remain separate checks. Isolated protocol probes and simulated paths are not a full-product live-device pass.

For API failures, open **Local diagnostic log** at the bottom of Settings. It keeps up to 30 failures from the last 24 hours of the current browser session, with redacted provider details and supported trace IDs. Transport HTTP status and an error event's status are separate: an HTTP 200 stream can still fail later, and a `spending_limit` event alone does not establish HTTP 402 or an exhausted subscription. Review the matching account's usage and the recorded cause before deciding what to change. Existing failures whose details were not retained cannot be reconstructed. Copying or clearing this local log does not call the provider or clear browsing history.

## 中文快速引导

**Grok 订阅（OAuth）**仅需浏览器，Windows 和 Mac 均无需 API Key、CLI 或额外程序：在「设置 → 连接」选择订阅登录，点击登录 Grok，核对短码后由本人在官方 xAI 授权页确认，再回到 SuperX。页面可能显示 **Grok Build**，这是当前共享 OAuth 客户端的身份，并非 SuperX 独立注册的应用或官方合作声明。账号资格、模型、额度与费用以提供方现行规则为准，不保证所有套餐适用。默认 4.3／关闭推理，不可用时由用户明确改选，不自动换成 4.7。

默认在本机记住登录：刷新 Token 由独立 AES-GCM 密钥加密，密钥在扩展 IndexedDB，访问 Token 只保留于受限会话和内存。无需密码、不使用同步；关闭记住后，浏览器新会话需重新登录。升级新增固定 `auth.x.ai` 主机权限，Chrome 可能要求批准。轮换结果无法确认或保存失败时重新登录，不能反复消费旧刷新 Token。退出 OAuth 不清除 API Key／本机配置或本机帖子访问记录。更换来源／账号后，生成回答、评论与历史中的生成内容按来源及授权身份隔离。

OAuth 已收到 HTTP 200 后的流错误、未完成或超时不自动重放；首次 HTTP 401 拒绝可刷新授权并恢复一次。其他帖子继续处理，手动重新核查前请先查看错误和部分输出。Windows Chrome 已实测新授权、真实 4.3 核查与可点出处、三条评论／复制、跨标签缓存，以及完全退出重开后无需重新授权的新核查请求。用户已实装确认 OAuth 退出正常、保持订阅来源时显示登录引导且不静默回退，原 API Key／Build 已配置项保留；本轮没有新增 API Key 实际推理或 CLI 安装／推理验收。macOS 实装和真实自然到期未测，不能据此保证所有套餐资格或 Included 计费。实测的是界面引用渲染，原生 annotation 原始协议仅有自动化覆盖；不将协议探测或模拟测试表述为完整产品通过。

**API Key 模式**在 Windows 和 Mac 上都只需浏览器：打开「设置 → 连接 → API Key」，按需展开获取帮助。使用订阅 API 额度时，去 [Grok Dashboard → API Keys](https://grok.com/dashboard/api-keys) 创建 **Grok Inference** 类型而非 Cursor 类型的 Key，按账号要求授权 Chat／模型；使用按量付费 API 时，去 [xAI 控制台](https://console.x.ai/) 创建 Key、购买额度。两种来源均粘贴到同一个 API Key 输入框并保存，不另选来源。默认在本机自动加密记住，无需 SuperX 密码；保存不代表已验证 API 权限或剩余额度。用量和费用请到创建 Key 的账户查看。

符合条件的订阅 API 使用计入共享周额度；也可在 [xAI 控制台](https://console.x.ai/) 购买按量付费额度。购买普通额度不等于启用额外收费的 Priority Processing，SuperX 当前使用标准处理。三种模式均默认在停止滚动、帖子连续可见满 1 秒后自动分析，设置可改为 0–30 秒，0 秒立即分析；API Key／OAuth 默认共享并发上限 3（可设 1–8），本机模式逐项执行。手动重新分析、评论及浏览历史不受停留等待影响。

**Grok CLI / ACP 模式**无需安装 SuperX 提供的其他程序：先按 [Grok 官方说明](https://github.com/xai-org/grok-build) 安装并用 `grok login` 登录。打开 SuperX 的逐步引导，选择 Windows 或 macOS，生成并复制启动命令；Windows 在 PowerShell、Mac 在终端执行。保持该窗口打开，回到 SuperX 检查连接、保存连接，再选择模型／推理档位并保存设置。检查连接不发送核查问题。

启动命令只监听本机地址，自动生成连接码并隔离工作／配置目录。连接码只用于本机官方服务，不是账号密码或 API Key；请勿公开连接码、完整命令或相关截图。SuperX 本机加密保存连接码，不读取或复制官方登录文件。重启电脑后需要重新运行启动命令；按 Ctrl+C 停止服务。浏览器断线不等于官方任务已经停止，若提示停止未确认，请在终端按 Ctrl+C 手动停止。停止后若提示仍在，请从设置重新加载 SuperX，再启动服务并重新检查连接；停止未确认时不会自动重试，也不会转为 API 计费。

CLI／ACP 支持 Windows 和 macOS 引导；此候选按官方 Grok 1.0.60 检查兼容性。工具限制不等同于系统沙箱，本机 CLI 的 Mac 及真实账号实机验收仍需另行完成。完整数据说明见 [隐私说明](../PRIVACY.md)。

Sources: [official Grok Build installation](https://github.com/xai-org/grok-build), [official agent / WebSocket mode](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md), [headless CLI and ACP](https://docs.x.ai/build/cli/headless-scripting).
