# mi-notic

本地 vibecoding 状态通知工具。监听 Codex/Cursor 的 Windows 系统通知或内部确认框，自动转发到飞书，再由手机飞书通知同步到小米手环。

```text
Windows Codex/Cursor 系统通知
  -> watch-notifications.mjs 捕获
  -> status.mjs 记录 info + 发飞书
  -> notify.mjs 发飞书
  -> 手机飞书通知
  -> 小米手环震动显示
```

内部确认框（v2，可选）：

```text
Codex/Cursor 内部确认弹窗
  -> watch-ui-prompts.mjs UI Automation 只读监听
  -> status.mjs 记录 wait + 发飞书
```

## Setup

1. 创建飞书自定义机器人并复制 webhook。
2. 复制 `.env.example` 为 `.env`。
3. 在 `.env` 填入 `FEISHU_WEBHOOK_URL`。
4. 如果飞书机器人开启了签名校验，也填入 `FEISHU_WEBHOOK_SECRET`。
5. 开启 Windows 通知监听权限：
   ```text
   Windows 设置 -> 隐私和安全性 -> 通知 -> 用户通知访问
   ```
   允许 PowerShell 或你用来运行 watcher 的终端读取通知。

飞书自定义机器人文档：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot

`.env` 和 `.local/` 都已被 `.gitignore` 忽略，不要提交真实 webhook、secret 或本地状态缓存。

## Quick Start

启动全量监听（推荐，覆盖 toast + AskQuestion/确认框）：

```powershell
npm run watch:all
```

或在 Cursor 中：`Tasks: Run Task` -> `mi-notic: watch all (toast + UI prompts)`

### 登录自启（推荐长期用）

Windows 登录后自动在后台启动 `watch:all`，无需开终端：

```powershell
npm run autostart:install
```

安装后会立即启动一次。日志：`.local/watch-all.log`

```powershell
npm run autostart:status   # 查看任务状态
npm run autostart:stop     # 停止后台 watcher
npm run autostart:start    # 手动启动后台 watcher
npm run autostart:uninstall  # 卸载登录自启并停止
```

任务名：`mi-notic-watch-all`

- 优先用**任务计划程序**（登录后 30 秒启动）
- 若权限不足，自动改用 **启动文件夹** 快捷方式（效果相同：登录即启）

> 仍需在 Windows 设置里允许 **PowerShell** 读取用户通知（用户通知访问）。

只监听系统 toast：

```powershell
npm run watch:notifications
```

探测当前可读通知（不发飞书）：

```powershell
node scripts/watch-notifications.mjs --probe --dry-run --apps "*"
```

只监听内部确认框 / AskQuestion UI（存在误报/漏报风险）：

```powershell
npm run watch:ui-prompts
```

发送测试通知：

```powershell
npm run notify:test
```

## Watch Commands

全量 watcher（推荐）：

```powershell
npm run watch:all
npm run watch:all -- --dry-run
```

系统通知 watcher：

```powershell
npm run watch:notifications
node scripts/watch-notifications.mjs --apps Codex,Cursor
node scripts/watch-notifications.mjs --interval 2
node scripts/watch-notifications.mjs --dry-run
node scripts/watch-notifications.mjs --probe
```

捕获 Codex/Cursor toast 后自动转发：

```text
Input needed / Command approval 等 -> status.mjs wait
其他 toast -> status.mjs info --notify --force
```

已转发通知 ID 保存在 `.local/watched-notifications.json`，避免重复转发。

### AskQuestion 与 toast 的区别

| 场景 | 监听方式 | 转发状态 |
|------|----------|----------|
| Cursor **失焦** `Input needed` toast | `watch:all` `[toast]` | `wait` |
| Codex `Command approval` toast | `watch:all` `[toast]` | `wait` |
| 普通 Done/完成 toast | `watch:all` `[toast]` | `info` |
| Cursor **聚焦** AskQuestion 聊天卡片 | **不会弹 toast** | 需 Cursor Rule |

**聚焦时 AskQuestion 不会弹 Windows 系统通知**，UI Automation 也读不到 Electron 聊天区。解决方案：

1. 全局 Cursor Rule：`.cursor/rules/mi-notic-askquestion.mdc`（已配置）
2. Agent 在 AskQuestion 前先执行：
   ```powershell
   node scripts/notify-ask.mjs "问题摘要"
   ```

Cursor Hook 目前**无法**直接拦截 AskQuestion 工具（Cursor 已知 bug）。

已配置用户级 Hook（`~/.cursor/hooks.json`）监听 `afterAgentResponse` / `stop`，尽力自动发通知。调试日志：`.local/cursor-hook.log`

聚焦场景下的多层方案：

1. **AskQuestion 前先 `notify-ask.mjs`**（聚焦主路径，Agent Rule 强制）
2. **`watch:all [toast]`**（失焦备用；notify-ask 已发后 120s 内 toast 自动跳过）
3. **Cursor Hook**（尽力而为；AskQuestion 通常不触发，日志见 `.local/cursor-hook.log`）

`status.mjs` 对 `wait` 做归一化去重 + 先发前写缓存，避免 notify-ask 与 toast 重复。

内部确认框 / 提问 UI watcher：

```powershell
npm run watch:ui-prompts
node scripts/watch-ui-prompts.mjs --probe --dry-run
```

命中确认或提问关键词后发送：

```powershell
node scripts/status.mjs wait "Codex/Cursor 等你回答：<摘要>" --force
node scripts/status.mjs wait "Codex/Cursor 需要你确认：<摘要>" --force
```

只读监听，不会自动点击或批准。

### 测试 AskQuestion 通知

```powershell
npm run watch:all -- --dry-run
```

1. 在 Agent 里触发 AskQuestion（例如让 Agent 先问你 1 个确认问题）
2. 观察终端 `[ui]` 是否打印 wait 消息
3. 若 `[ui]` 无输出，最小化 Cursor 后再触发一次，观察 `[toast]` 是否捕获 `Input needed`
4. 单独探测 UI：`node scripts/watch-ui-prompts.mjs --probe`

## Manual Commands

仍可直接手动记录状态或包装命令：

```powershell
npm run status -- running "Codex 正在执行"
npm run status -- wait "需要你确认方案"
npm run status -- done "任务完成"
npm run run:notify -- --name "测试" -- npm test
npm run check:status
```

## Scripts

`notify.mjs` 只负责发飞书通知：

```powershell
node scripts/notify.mjs done "Codex 任务完成"
node scripts/notify.mjs done "Codex 任务完成" --dry-run
```

`status.mjs` 负责写入 `.local/status.json`，并按状态决定是否通知：

```powershell
node scripts/status.mjs done "Codex 任务完成" --force
node scripts/status.mjs running "Codex 正在执行" --notify
node scripts/status.mjs info "Codex 通知" --notify --force
```

默认会通知的状态：

```text
test, done, error, wait, ask
```

`running` 和 `info` 默认只记录不通知。相同状态和消息在 5 分钟内不会重复通知。

`run-notify.mjs` 负责包装命令：

```powershell
node scripts/run-notify.mjs --name "成功命令" -- node -e "process.exit(0)"
node scripts/run-notify.mjs --name "失败命令" --tail 8 -- node -e "process.exit(1)"
```

`check-status.mjs` 负责查看和巡检状态：

```powershell
node scripts/check-status.mjs --stale-minutes 30
```

## Integrations

Cursor 使用 `.vscode/tasks.json`，详见 `docs/cursor.md`。

Codex 能力说明见 `docs/codex.md`。

## Message Format

飞书/手环展示**编辑器 + 分类 + 任务名**，三行，适合小屏：

```text
Cursor
完成
计划.md
```

```text
Codex
需要操作
选 A 还是 B
```

任务名来源（第三行）：
1. `--task` 显式指定
2. 从 message 自动提取（去掉 `[完成]` 等前缀，或从 `构建完成` 提取 `构建`）
3. 无有效任务名时只显示前两行

编辑器名来源（按优先级）：
1. `--editor Codex|Cursor` 或 `MI_NOTIC_EDITOR`
2. Windows toast 的应用名（Codex / Cursor）
3. 消息里的 Codex / Cursor 关键词
4. 默认 `Cursor`

分类映射：

| 分类 | 对应 status |
|------|-------------|
| 完成 | `done`，或 toast 含 Done / View the agent's output |
| 需要操作 | `wait` / `ask`，或 toast 含 Input needed / Command approval |
| 异常 | `error` |
| 提示 | 其他 `info` |
| 测试 | `test` |
| 进行中 | `running` |

内部仍保留完整摘要用于去重（`.local/status.json`），但发到飞书的内容已压缩。Toast 文案会自动去掉 `Open Cursor to answer...` 等 boilerplate。

支持 status：

```text
test, info, running, done, error, wait, ask
```

可选环境变量：

```text
VIBECODING_NOTIFY_DEDUPE_SECONDS=300
MI_NOTIC_EDITOR=Cursor
```
