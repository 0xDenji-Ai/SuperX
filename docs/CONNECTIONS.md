# Connecting SuperX / 连接 SuperX

The unreleased 0.9.0 candidate provides two independent routes. API Key remains the default. Selecting a route never transfers credentials to the other route, falls back to it, or retries a paid task automatically. Published Stable remains 0.7.26 until a later release is accepted.

## API Key — no local connector

1. In **SuperX Settings → Connect with**, select **API Key**.
2. For **The X Subscription**, open [Grok Dashboard → API Keys](https://grok.com/dashboard/api-keys). Choose **Grok Inference** as the Key type, rather than the default **Cursor** type. Allow Chat and any required model permissions. Existing [xAI Console](https://console.x.ai/) Keys also work.
3. Paste your own Key, choose the model and reasoning effort, and save. Remember Key is on by default and restores the encrypted Key after a browser restart, without a password.
4. Enable SuperX and open X. [Grok Dashboard usage](https://grok.com/dashboard/usage) and your account's provider rules determine entitlement, limits and charges. A subscription label alone does not establish free or unlimited API use.

Both Windows and macOS use the same browser-only setup. No terminal, connector, Node or npm is needed for this route.

## Grok Build — official login, ACP or CLI

Supported installation targets: **Windows x64**, **macOS Apple silicon (arm64)** and **macOS Intel (x64)**, with Chrome or Chromium-based Edge 120+. Windows ARM and Linux connector installation are not included in this candidate.

1. Install the matching SuperX candidate, then open **Settings → Grok Build → Install connector**. Copy the extension ID shown in that built-in guide. This matters for unpacked copies whose IDs differ from the store installation.
2. Download `SuperX-Connector-<version>.zip` from the same Release attachments and extract it. A local, unpublished candidate provides this ZIP alongside the extension ZIP.
3. Run the matching command **from the extracted folder**:

   Windows PowerShell:

   ```powershell
   .\install-windows.ps1 -ExtensionId YOUR_EXTENSION_ID
   ```

   macOS Terminal:

   ```sh
   bash ./install-macos.command --extension-id YOUR_EXTENSION_ID
   ```

4. The installer downloads official **Node 22.23.3** and **Grok Build 1.0.60**, validates pinned SHA-256 / SHA-512 digests, and installs only for the current OS user. No administrator access, existing Node, npm or Python is required. It registers the host for that user's Chrome and Edge, with exact permitted extension IDs. Inspect a downloaded script before allowing it under your device's policy; do not disable OS security controls.
5. Sign in through the installed official client. Existing official Grok Build login can be reused. For a new login, run:

   Windows PowerShell:

   ```powershell
   & "$env:LOCALAPPDATA\SuperX\Connector\login-windows.ps1"
   ```

   macOS Terminal:

   ```sh
   bash "$HOME/Library/Application Support/SuperX/Connector/login-macos.command"
   ```

6. Return to SuperX, allow the optional native-messaging permission, and select **Check connection**. This checks the local runtime, official login and model configuration without a Fact Check prompt. Choose an available model and reasoning effort, then save. A connection check during an active task reuses its last confirmed status rather than interrupting that task.

**ACP** is the default and reuses a local process while creating a fresh session for each post. **CLI** launches a separate headless command for each task. Both use the same official login and restricted tool profile; even CLI uses a zero-prompt ACP preflight to validate that profile. Neither is a quota workaround or a promise of lower latency. Visible posts queue immediately; this candidate runs Build tasks one at a time. Fast variants are offered only when actually advertised by the host and are never selected automatically.

The connector does not read or copy login files. The official client reads its own existing login through its supported auth-path setting; SuperX gives it an isolated temporary Grok home and working directory and disables imported coding/MCP tools. Personal Grok configuration is left unchanged. System-managed policies are not bypassed. The host rejects reverse local-file, terminal, permission and delegation requests, validates the configured tool list and only counts actual hosted search events as search evidence. This is an application restriction, not an OS sandbox or proof against a compromised runtime.

Post context, selected prompts and optional earlier findings pass through the native host to official Grok Build and its provider. The CLI route also uses a temporary prompt file, removed during normal cleanup. Model reasoning/tool-command JSON is not displayed as a reader answer. Token counts are shown only when reported; they are not a measurement of subscription cash charges. The official client can make supporting requests such as session-title generation in addition to the main turn.

### Troubleshooting and removal

| State | Action |
| --- | --- |
| Missing connector | Install for the current OS user, browser and exact extension ID. Then reconnect or restart the browser. |
| Permission denied | Allow optional native messaging from SuperX's Check connection button. API mode does not require this permission. |
| Login required | Run the official login script above, then check again. SuperX never asks you to paste OAuth tokens or cookies. |
| Model / effort unavailable | Check the host-reported choices. API and Build model catalogs can differ; the connector does not silently substitute a model or effort. |
| Unsupported runtime | Reinstall the matching connector. This candidate pins Grok Build 1.0.60; newer runtimes need separate compatibility review. |
| Unsupported configuration / tool policy | Reconnect the extension to create a clean temporary profile. The temporary directory must be outside a Git checkout. If system-managed Grok or other managed coding policies are detected, use API mode or contact the device administrator; do not delete company policies. |
| Disconnected / timeout / usage limit | The task stops and retains genuine partial findings / usage where available. Retry manually after resolving the issue; no automatic paid retry or provider fallback occurs. |

To remove the connector, use the **downloaded** installer so its temporary Node process can remove the installed runtime without locking itself:

First fully quit Chrome and Edge, including background processes. The installer refuses to remove a running Windows runtime before changing its registrations; close the browsers and retry rather than forcing deletion.

```powershell
.\install-windows.ps1 -Uninstall
```

```sh
bash ./install-macos.command --uninstall
```

Uninstall removes SuperX's own registration and managed connector files, while preserving official Grok login/configuration, extension API Keys and browser history. Removing the browser extension alone does not uninstall the connector.

Automated tests exercise Windows and macOS paths and protocol behavior. Actual macOS login, browser integration and OS prompts still require acceptance on a Mac; cross-platform mock tests are not live-device verification.

---

## 中文快速开始

**API Key 模式**默认启用，Windows 和 macOS 流程一致，无需安装连接器。The X Subscription 用户在 [Grok Dashboard → API Keys](https://grok.com/dashboard/api-keys) 创建 **Grok Inference** 类型的 Key，而非默认 Cursor 类型，为 Chat 和所用模型授权；已有普通 xAI Console Key 仍可用。粘贴到 SuperX 设置并保存即可。是否计入订阅、可用额度和费用以自己账号的 [Dashboard](https://grok.com/dashboard/usage) 及提供方规则为准，不承诺免费或无限量。

**Grok Build 模式**支持 Windows x64、Apple 芯片 Mac 和 Intel Mac。设置中选择 Grok Build，打开连接器安装指南，复制当前扩展 ID。下载同版本 `SuperX-Connector-<版本>.zip` 并解压，在该目录运行上面的对应系统安装命令。安装器自动下载并校验官方 Node 和 Grok Build，只安装到当前用户，无需管理员权限或手动安装运行时。

然后运行上方对应系统的登录脚本，在官方页面完成登录；已有官方登录可以复用。回到 SuperX 允许本机连接权限，检查连接，选择模型、推理档位并保存。检查不发送核查问题。ACP 复用进程，CLI 每次启动独立命令；二者共用官方账号，帖子立即排队、逐项执行，不用于绕过额度。不会在失败时自动重发或切换到 API 计费。

SuperX 不读取、复制官方登录凭据，不改个人 Grok 配置；官方客户端在临时隔离工作目录下运行。受企业系统策略管理的设备可能不支持，不要为连接器删除公司策略。帖子、指令和评论上下文仍会通过官方客户端发给提供方。卸载使用下载目录中的脚本和上面的卸载参数；不会删除官方登录、扩展 API Key 或浏览历史。Mac 的实际登录与浏览器端到端验收仍需在 Mac 上完成。

卸载前请完全退出 Chrome／Edge，包括后台进程。Windows 运行时被占用时，安装器会在修改注册前停止；关闭浏览器后重试即可。

Sources: [official Grok Build](https://github.com/xai-org/grok-build), [headless CLI and ACP](https://docs.x.ai/build/cli/headless-scripting), [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
