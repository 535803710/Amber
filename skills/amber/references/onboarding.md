# Amber 首次接入

按顺序做完即可。每一步都用 CLI，不要手改 IDE JSON 或把 Webhook/Token 贴进对话。

## 1. 首次安装

在 Windows PowerShell 执行其一：

```powershell
npx --yes --registry=https://npm-fe.transsion.com/ @amber/cli@beta install
```

已有仓库源码时：

```powershell
node bin/amber.mjs install
```

已设置 `AMBER_HOME` 时：

```powershell
%AMBER_HOME%\amber.bat install
```

加 `--json` 可确认 `status` 为 `ok` 或 `needs_action`。安装会写入 Runtime、Skill、Hook/MCP、自启动和开始菜单快捷方式，并进入空间配置。

## 2. Hook 信任

Cursor / Codex 会提示信任新的用户级 Hook。必须由用户在 IDE 里点允许；Agent 不能代点，也不要去改 Hook JSON。

若 CLI 返回 `needs_action` 且 `actions` 提到 Hook，请用户完成信任后重新执行：

```powershell
node bin/amber.mjs doctor --json
```

## 3. amber space init

每个使用 Amber 的人（或项目组）先有一个自己的飞书空间：

```powershell
node bin/amber.mjs space init --json
```

同事要加入已有空间时用 `space connect`，不要再复制一份模板。`space status` 可查看当前连接。

`space init` 会按用户身份复制飞书模板「【琥珀计划】AI 记录沉淀 - 模板」，识别 Base token，以及 `VibeCoding修改记录`（产品侧称 AI 修改记录）和 `Git提交记录` 两张表，并打开该 Base，方便进入两个「接收到 Webhook 时」工作流。

## 4. 粘贴两个 webhook

CLI 不会替用户复制飞书工作流地址。请用户分别从两个工作流页面复制 Webhook，再按 `actions` 提示粘贴回 CLI（AI 修改记录一条、Git 提交记录一条）。

粘贴时：

- 只在 CLI 提示处输入，不要发到聊天窗口。
- 不要读取或复述 `.env.local` 里的完整 URL / token。
- CLI 会发带 `setup-test` 标识的测试事件；HTTP 2xx 且入表成功才算完成。

未完成时常见 `code` 为 `webhook_setup_required`，见 [troubleshooting.md](troubleshooting.md)。

## 5. project add

空间只需创建一次。之后把要采集的本地仓库加进去：

```powershell
node bin/amber.mjs project add --json
```

在目标仓库外执行时带上绝对路径。`project list` 核对结果；`project remove` 停止采集。

完成后可用 `open` 打开控制台，或 `doctor` 做一次健康检查。
