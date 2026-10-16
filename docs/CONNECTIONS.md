# Connect SuperX

The unreleased **0.9.9** candidate offers two independent modes. **API Key** is the default. **Grok CLI / ACP** connects directly to the official Grok service on your computer. Neither mode automatically falls back to the other or resubmits a paid task. Published Stable remains **0.7.26**.

## API Key

This is the simplest setup on both Windows and macOS. No terminal or extra local software is required.

1. Open SuperX **Settings → API Key**.
2. If you use The X Subscription, open [Grok Dashboard → API Keys](https://grok.com/dashboard/api-keys). Choose **Grok Inference** as the Key type; the default **Cursor** type is not suitable. Enable **Chat** and the model permissions required by your account. Existing [xAI Console](https://console.x.ai/) Keys also work.
3. Create a Key, paste it into SuperX, and save. **Remember Key on this device** is selected by default and restores it after browser restart without a SuperX password.
4. Select an available model and reasoning effort. Enable SuperX and open X.

Entitlement, usage limits and charges depend on your account and the provider's rules. Check [Grok Dashboard usage](https://grok.com/dashboard/usage); a subscription is not a promise of free or unlimited API usage. See [Privacy](../PRIVACY.md) for data and credential handling.

Eligible API use from The X Subscription shares the plan's weekly allowance. For pay-as-you-go API use, create a Key and add credits in [xAI Console](https://console.x.ai/); tokens and tool calls are billed there. Purchasing standard credits does not automatically improve processing priority. [Priority Processing](https://docs.x.ai/developers/advanced-api-usage/priority-processing) requires explicit opt-in and extra payment; SuperX currently uses standard requests. Priority can reduce peak-time latency but does not guarantee availability.

## Grok CLI / ACP — official local connection

Use the official Grok installation and account login. **No separate SuperX installer, Node installation, browser host registration or downloaded profile file is required.** The browser communicates with the official CLI's ACP WebSocket service; it cannot start terminal programs by itself.

The guide covers **Windows PowerShell** and **macOS Terminal**, including Apple silicon and Intel Macs supported by the official Grok distribution. Use desktop Chrome or Chromium-based Edge 120+. This candidate checks compatibility with **Grok Build 1.0.60** before sending a task; another version is rejected until its protocol and restrictions are reviewed.

1. Follow the [official Grok installation instructions](https://github.com/xai-org/grok-build). Open PowerShell on Windows or Terminal on macOS. Run `grok --version` to check the installation, then `grok login` and finish signing in on the official page. SuperX does not ask for your account password or receive the login token.
2. Open **SuperX Settings → Grok CLI / ACP → Step-by-step guide**. Select Windows or macOS, then **Generate launch command**. SuperX creates a random local connection code automatically; you do not need to invent a password or edit configuration files.
3. Copy the generated command into that terminal and run it. It starts the official service on **127.0.0.1**, with an isolated temporary working/configuration directory and restricted discovery settings. Keep the terminal open while using this mode.
4. Return to SuperX and select **Check connection**. Approve the browser's optional access to the local address if asked. The check confirms the official login, protocol, available models and restricted session without sending a Fact Check or comment prompt.
5. **Save connection**, choose an available model and reasoning effort, and save settings. Enable SuperX and open X. The local mode uses its own selections; it does not use your extension API Key.

For daily use, start the generated command before opening X. After restarting your computer, start it again; SuperX cannot automatically launch the official CLI. If you generate a new connection code, run the new command and save the new connection together. To stop the service, press **Ctrl+C** in its terminal. You can switch back to API Key mode at any time.

The service is bound to this computer, not the local network or a public relay. The connection code authorizes access to that local service. Keep it, the generated command and screenshots of either private. It is not your Grok account password or API Key. SuperX encrypts its saved copy locally and does not send it to X or a SuperX server. Local encryption does not protect a compromised device or full browser profile. Terminal history and your clipboard can retain a copied command; generating a new code and stopping the old service invalidates that old connection.

SuperX supplies a restricted profile for each new post session, checks that the actual local-function count is zero, refuses filesystem/terminal/permission requests and observes only the allowed hosted search events. The generated launch command also disables imported coding/MCP integrations. These are application restrictions, **not an operating-system sandbox** or a guarantee against a compromised official runtime. Do not replace the generated command with `--always-approve` or expose the service on `0.0.0.0`.

Closing a browser connection alone does not guarantee that an official-service task stops. SuperX explicitly requests cancellation and session closure; if it cannot confirm this, it reports the uncertainty instead of retrying. Press Ctrl+C in the service terminal if a stop cannot be confirmed. If the warning remains after the service has stopped, reload SuperX from Settings, then start and check the service again; the worker deliberately keeps an unresolved-session block until it can confirm cleanup or is reloaded. Already submitted work may count against provider usage. Official Grok can make supporting requests, such as generating session titles, in addition to the main task.

In both connection modes, automatic analysis waits until feed/page scrolling stops and a post remains visible for the configured time: 1 second by default, adjustable from 0 to 30 seconds in Settings. Further scrolling resets pending work's timer; scrolling inside SuperX's answers does not. Zero starts immediately, and manual reanalysis/comments bypass the wait. API concurrency defaults to 3 (configurable from 1 to 8); local Grok tasks run serially with a fresh session per post. Neither ACP nor the selected reasoning effort guarantees lower latency or lower quota consumption. Reported Token counts are not a measurement of subscription cash charges.

## Troubleshooting

| Message or situation | Next step |
| --- | --- |
| `grok` is not found | Finish the official installation, then reopen PowerShell or Terminal so its PATH is updated. |
| Sign-in required | Run `grok login` outside the SuperX launch command, complete the official login and check again. |
| Cannot connect | Keep the service terminal open. Check that its port and code match SuperX; stop any older service before starting a replacement. |
| Local permission denied | Allow SuperX's optional local-address access from the connection check. API mode does not need it. |
| Unsupported version | Compare `grok --version` with this candidate's tested version. Use API mode while a newer official runtime is awaiting compatibility review. |
| Model / effort unavailable | Select the choices reported by the connected account. API and CLI catalogs may differ; no model is silently substituted. |
| Restricted session could not be confirmed | Use the generated command. Managed-device policy may prevent this setup; do not disable company protections. API mode remains available. |
| Stop could not be confirmed | Press Ctrl+C in the official service terminal. SuperX does not replay the request automatically. |
| Usage / account limit | A structured API 402 or account-limit code pauses automatic API work across tabs and worker sleep. Check the matching account's usage and billing; after resolving the limit, retry one post manually. A complete successful probe resumes new work; failed checks are not automatically replayed. Ordinary settings edits or saving the same Key do not reset this pause. Switching transport is not a quota workaround. |

Windows and macOS command generation and protocol behavior have automated coverage. Installed-browser acceptance with a real account, including macOS devices, remains a separate release check; simulated paths are not a live-device pass.

For API failures, open **Local diagnostic log** at the bottom of Settings. It keeps up to 30 failures from the last 24 hours of the current browser session, with redacted provider details and supported trace IDs. Transport HTTP status and an error event's status are separate: an HTTP 200 stream can still fail later, and a `spending_limit` event alone does not establish HTTP 402 or an exhausted subscription. Review the matching account's usage and the recorded cause before deciding what to change. Existing failures whose details were not retained cannot be reconstructed. Copying or clearing this local log does not call the provider or clear browsing history.

## 中文快速引导

**API Key 模式**在 Windows 和 Mac 上都只需浏览器：设置中选择 API Key，打开 [Grok Dashboard → API Keys](https://grok.com/dashboard/api-keys)，创建 **Grok Inference** 类型而非 Cursor 类型的 Key，按账号要求授权 Chat／模型，粘贴并保存。已有 xAI 控制台 Key 可继续使用。默认在本机自动加密记住，无需 SuperX 密码。订阅权益、限额及费用以账号用量页和提供方规则为准。

符合条件的订阅 API 使用计入共享周额度；也可在 [xAI 控制台](https://console.x.ai/) 购买按量付费额度。购买普通额度不等于启用额外收费的 Priority Processing，SuperX 当前使用标准处理。两种模式均默认在停止滚动、帖子连续可见满 1 秒后自动分析，设置可改为 0–30 秒，0 秒立即分析；API 默认并发 3（可设 1–8），本机模式逐项执行。手动重新分析、评论及浏览历史不受停留等待影响。

**Grok CLI / ACP 模式**无需安装 SuperX 提供的其他程序：先按 [Grok 官方说明](https://github.com/xai-org/grok-build) 安装并用 `grok login` 登录。打开 SuperX 的逐步引导，选择 Windows 或 macOS，生成并复制启动命令；Windows 在 PowerShell、Mac 在终端执行。保持该窗口打开，回到 SuperX 检查连接、保存连接，再选择模型／推理档位并保存设置。检查连接不发送核查问题。

启动命令只监听本机地址，自动生成连接码并隔离工作／配置目录。连接码只用于本机官方服务，不是账号密码或 API Key；请勿公开连接码、完整命令或相关截图。SuperX 本机加密保存连接码，不读取或复制官方登录文件。重启电脑后需要重新运行启动命令；按 Ctrl+C 停止服务。浏览器断线不等于官方任务已经停止，若提示停止未确认，请在终端按 Ctrl+C 手动停止。停止后若提示仍在，请从设置重新加载 SuperX，再启动服务并重新检查连接；不会自动重试或转为 API 计费。

支持 Windows 和 macOS 引导；此候选按官方 Grok 1.0.60 检查兼容性。工具限制不等同于系统沙箱，Mac 及真实账号实机验收仍需另行完成。完整数据说明见 [隐私说明](../PRIVACY.md)。

Sources: [official Grok Build installation](https://github.com/xai-org/grok-build), [official agent / WebSocket mode](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md), [headless CLI and ACP](https://docs.x.ai/build/cli/headless-scripting).
