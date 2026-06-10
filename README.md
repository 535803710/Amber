# mi-notic

每次 vibecoding 等待的时候总是去摸鱼🐟 刷刷擦边

但是一刷手机忘了看屏幕，

导致很多次都刷的太入迷忘记了自己是“李鸿章”，还需要签署洋大人的“条约”  （忘记codex和cursor还要点确认


## 省流（TL;DR）

```powershell
# 1. 配 webhook
copy .env.example .env
# 填 FEISHU_WEBHOOK_URL

# 2. 登录自启（推荐，后台跑，不用开终端）
npm run autostart:install

# 3. 测链路
npm run notify:test
```

飞书推过来长这样：

```text
Cursor
完成
计划.md
```

想手动开 watcher：`npm run watch:all`

**可视化控制台**：`npm run dashboard` → 浏览器打开 http://127.0.0.1:3847

Cursor 里：`Tasks: Run Task` → `mi-notic: watch all (toast + UI prompts)`

---

## 链路

```text
Codex / Cursor（Windows toast / 确认框 / notify-ask）
  -> watch-*.mjs 监听
  -> notify-ask --queue 写本地 outbox（Codex 对话内提问）
  -> status.mjs 记状态 + 决定去不去重
  -> notify.mjs 发飞书
  -> 手机飞书通知
```

三条监听线并行跑：

| 线 | 脚本 | 抓什么 |
|----|------|--------|
| toast | `watch-notifications.mjs` | 系统通知：`Done`、`Input needed`、`Command approval` |
| UI | `watch-ui-prompts.mjs` | 内部确认框（UI Automation，有误报/漏报） |
| outbox | `watch-outbox.mjs` | Codex 沙箱内主动写入的通知请求 |

`watch-all.mjs` 把三条同时启动，日常用这个就行。

---

## 第一次配

1. 飞书建自定义机器人，复制 webhook → [文档](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)
2. `copy .env.example .env`，填 `FEISHU_WEBHOOK_URL`
3. 开了签名校验再填 `FEISHU_WEBHOOK_SECRET`
4. Windows 打开**用户通知访问**：
   ```text
   设置 -> 隐私和安全性 -> 通知 -> 用户通知访问
   ```
   允许 **PowerShell** 读通知，后台 watcher 是 PowerShell 起的

`.env` 和 `.local/` 在 `.gitignore` 里，别提交 webhook。

---

## 登录自启

不想每次开终端，装一次：

```powershell
npm run autostart:install    # 安装 + 立即启动
npm run autostart:status     # 看装没装
npm run autostart:stop       # 停后台 watcher
npm run autostart:start      # 手动启
npm run autostart:uninstall  # 卸掉
```

- 日志：`.local/watch-all.log`
- 优先任务计划程序（登录后 30 秒）；没权限就退到**启动文件夹**，效果一样

改完 `scripts/` 记得重启 watcher：

```powershell
npm run autostart:stop && npm run autostart:start
```

---

## 内嵌提问：最容易踩的坑

Cursor 聚焦时，Agent 在聊天里问问题**不会弹 Windows toast**。UI Automation 也读不到 Electron 聊天区（Cursor 自己的坑）。

Codex 的对话内选择/输入提示也一样：它是 Codex 内部 UI，不一定产生 Windows toast，`watch:all` 也不一定能读到。所以这种场景不要赌 UI 监听，主路径是**提问前写 outbox，由后台 watcher 发 wait**。

所以实际能走的路：

| 场景 | 怎么通知 | 状态 |
|------|----------|------|
| Cursor **失焦**，弹 `Input needed` toast | `watch:all` 自动抓 | `wait` |
| Codex `Command approval` toast | 同上 | `wait` |
| 普通 `Done` toast | 同上 | `done` |
| Cursor **聚焦** AskQuestion | Agent 先跑 `notify-ask.mjs` | `wait` |
| Codex 对话内选择/输入提示 | Agent 先跑 `notify:ask:codex` 写 outbox | `wait` |

聚焦的主路径——AskQuestion **之前**先 Shell：

```powershell
node scripts/notify-ask.mjs "问题摘要"
# 或
npm run notify:ask -- "问题摘要"

# Codex 对话内提问/选择题
npm run notify:ask:codex -- "问题摘要"
```

项目里配了 Cursor Rule：`.cursor/rules/mi-notic-askquestion.mdc`
Codex 侧规则在 `AGENTS.md`：调用 `request_user_input`、提出选择题、等待确认前先跑 `notify:ask:codex`。这个命令只写 `.local/notify-outbox`，不会在 Codex 沙箱里直接连飞书。

试过的路 🤔：

- [x] **Codex notify-ask + AGENTS.md**：对话内选择/输入提示主路径
- [x] **notify-ask + Rule**：聚焦场景主路径
- [x] **watch:all toast**：失焦备用
- [x] **120s pending 窗口 + wait 去重**：notify-ask 发过后，toast 不再双发
- [ ] ~~Hook 拦 AskQuestion~~：Cursor 已知 bug，AskQuestion 不触发 preToolUse/postToolUse
- [ ] ~~UI Automation 读聊天 AskQuestion~~：基本读不到

Hook 还是挂着的（`~/.cursor/hooks.json`，`afterAgentResponse` / `stop`），当个备胎。调试看 `.local/cursor-hook.log`。

### 测一下

```powershell
npm run watch:all -- --dry-run
```

1. 让 Agent 用 AskQuestion 问你一个问题
2. 看终端 `[ui]` 有没有 wait
3. 没有就最小化 Cursor 再触发，看 `[toast]` 能不能抓到 `Input needed`
4. 单独探 UI：`node scripts/watch-ui-prompts.mjs --probe`

---

## 飞书消息格式

三行，对着手机看没压力：

```text
Cursor          ← 编辑器（Codex / Cursor）
完成            ← 分类
计划.md         ← 任务名
```

**编辑器**优先级：`--editor` → toast 应用名 → 消息关键词 → 默认 `Cursor`

**分类**：

| 显示 | 触发条件 |
|------|----------|
| 完成 | `done`，或 toast 带 Done / View the agent's output |
| 需要操作 | `wait` / `ask`，或 Input needed / Command approval |
| 异常 | `error` |
| 提示 | 其他 `info` |
| 测试 / 进行中 | `test` / `running` |

**任务名**（第三行）：`--task` 指定，或从 message 里抠（`[完成] 计划.md` → `计划.md`；`构建完成` → `构建`）。太泛的词不显示第三行。

完整摘要留在 `.local/status.json` 做去重用，发出去的是压缩版。

---

## 可视化控制台

本地网页，不用记命令：

```powershell
npm run dashboard
```

Windows 下也可以直接双击根目录 `mi-notic.bat`，或者在终端运行：

```powershell
.\mi-notic.bat open      # 启动控制台服务并打开浏览器
.\mi-notic.bat start     # 后台启动 watch:all
.\mi-notic.bat stop      # 停止后台 watch:all
.\mi-notic.bat status    # 查看控制台、监听和最近状态
```

浏览器打开 http://127.0.0.1:3847 ，可以：

| 功能 | 说明 |
|------|------|
| 开关监听 | 启停 `watch-notifications`（系统 toast） |
| 通知设置 | 勾选「需要操作 / 任务完成 / 其他提示」哪些场景发飞书 |
| 监听状态 | 进程、Windows 通知权限、飞书 Webhook 是否配置 |
| 最近通知 | 读 `.local/status.json` 最后一条 |
| 测试通知 | 发一条飞书测试消息 |

设置保存在 `.local/settings.json`，toast watcher 会实时读取。

当前控制台只管 **系统 toast 监听**（失焦场景最稳定）。聚焦时的 AskQuestion 不在本次范围。

---

## 常用命令

### 监听

```powershell
npm run dashboard              # 可视化控制台
npm run watch:all              # 全量（推荐）
npm run watch:notifications    # 只 toast
npm run watch:ui-prompts       # 只 UI 确认框
npm run watch:outbox           # 只本地 outbox

# 调试用
npm run watch:all -- --dry-run
node scripts/watch-notifications.mjs --probe --apps "Cursor"
node scripts/watch-ui-prompts.mjs --probe
node scripts/watch-outbox.mjs --probe
```

toast 分类：

```text
Input needed / Command approval  -> wait（需要操作）
Done / View the agent's output   -> done（完成）
其他                              -> info（提示）
```

### 手动触发 / 包装命令

```powershell
npm run notify:test
npm run status -- done "任务完成" --editor Cursor --task "计划.md"
npm run status -- wait "需要你确认" --force
npm run run:notify -- --name "测试" -- npm test
npm run check:status
npm run check:status -- --stale-minutes 30   # running 太久告警
```

`status.mjs` 默认会发通知：`test, done, error, wait, ask`。

`running` / `info` 只记不发。同状态 + 同消息 5 分钟内不重复（`VIBECODING_NOTIFY_DEDUPE_SECONDS`，默认 300）。

### 脚本分工（翻代码时对照）

| 脚本 | 干什么 |
|------|--------|
| `notify.mjs` | 只发飞书 |
| `notify-format.mjs` | 编辑器 / 分类 / 任务名格式化 |
| `status.mjs` | 写 `.local/status.json`，决定要不要发、去不去重 |
| `run-notify.mjs` | 包一层命令：开始 running → 成功 done / 失败 error |
| `check-status.mjs` | 看最新状态，可选 stale 巡检 |
| `notify-ask.mjs` | AskQuestion 前主动发 wait |
| `ask-notify-window.mjs` | 120s 窗口，防 notify-ask + toast 双发 |
| `watch-outbox.mjs` | 后台发送 `.local/notify-outbox` 中的通知请求 |

---

## 状态在哪看

| 想确认什么 | 去哪 |
|------------|------|
| 自启装没装 | `npm run autostart:status` |
| watcher 跑没跑 | `.local/watch-all.log`、`.local/watch-all.pid` |
| 最后一条通知 | `npm run check:status` 或 `.local/status.json` |
| Hook 有没有触发 | `.local/cursor-hook.log` |

---

## Cursor / Codex 集成

- Cursor Tasks：`.vscode/tasks.json`（命令面板搜 `mi-notic:`）
- 详细说明：`docs/cursor.md`、`docs/codex.md`

---

## 环境变量

```text
FEISHU_WEBHOOK_URL              必填
FEISHU_WEBHOOK_SECRET           可选，签名校验
MI_NOTIC_EDITOR                 可选，默认编辑器名
VIBECODING_NOTIFY_DEDUPE_SECONDS  去重窗口，默认 300
MI_NOTIC_HOME                   Hook / notify-ask 找仓库路径时用
```

---

## `.local/` 里有什么

| 文件 | 用途 |
|------|------|
| `status.json` | 最新状态 |
| `notify-cache.json` | 去重缓存 |
| `watched-notifications.json` | 已处理 toast |
| `watched-ui-prompts.json` | 已处理 UI 弹窗 |
| `notify-outbox/` | Codex 沙箱内排队等待后台发送的通知 |
| `pending-ask-notify.json` | notify-ask 防双发 |
| `watch-all.log` / `watch-all.pid` | 后台 watcher |
| `watch-toast.log` / `watch-toast.pid` | 控制台管理的 toast watcher |
| `settings.json` | 控制台通知设置 |
| `cursor-hook.log` | Hook 调试 |

---

## 还没搞定的

1. Codex/Cursor 对话内提问不一定弹 toast，只能靠规则 + `notify-ask`
2. Hook 拦不到 AskQuestion 工具调用
3. UI watcher 对 Electron 聊天区基本无效
4. Windows 必须开**用户通知访问**，PowerShell 要放行

`autostart:install` 装一次，后面就不用管了。Agent 完成或者卡着等你，飞书直接推过来。
