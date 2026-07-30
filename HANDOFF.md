# mi-notic 当前改动交接

更新时间：2026-07-30

当前分支：`vscode`

基准提交：`164e9df docs(README): 更新文档添加项目效果图片和GitHub链接`

## 项目目标

在保留原有飞书群通知的基础上，新增两条本地记录链路：

1. Cursor / ChatGPT 每轮实际文件修改写入飞书多维表格。
2. `D:/project` 下 Git 仓库产生本地 commit 后写入另一张飞书多维表格。

## 当前 Git 工作区

已修改但未提交：

- `.env.example`
- `README.md`
- `dashboard/app.js`
- `dashboard/index.html`
- `package.json`
- `scripts/dashboard-server.mjs`
- `scripts/notify-format.mjs`
- `scripts/watch-all.mjs`
- `scripts/watch-notifications.mjs`
- `scripts/watch-ui-prompts.mjs`
- `scripts/windows-ui-prompt-listener.ps1`

新增但未跟踪：

- `scripts/change-record-worker.mjs`
- `scripts/commit-record-worker.mjs`
- `scripts/hooks/on-change-event.mjs`
- `scripts/hooks/on-codex-event.mjs`
- `scripts/lib/change-records.mjs`
- `scripts/lib/commit-records.mjs`
- `test/change-records.test.mjs`
- `HANDOFF.md`

现有已跟踪文件差异约为 `299 additions / 13 deletions`，不包含上述新增文件。

## AI 修改记录

主要实现：

- 任务开始时用临时 Git index 生成工作区基线 tree。
- 任务结束时生成结果 tree，并比较两棵 tree。
- 支持新增、修改、删除、重命名、暂存和未跟踪文件。
- 仅有实际文件变化时生成事件。
- 不保存完整 diff 或源码。
- 事件写入本地 pending 队列，由 worker 投递。
- 支持超时重试、失败队列、幂等事件 ID、dry-run 和失败重放。
- 仪表盘展示配置状态、最近成功时间、pending / failed 数量和重放入口。

相关文件：

- `scripts/lib/change-records.mjs`
- `scripts/change-record-worker.mjs`
- `scripts/hooks/on-change-event.mjs`
- `test/change-records.test.mjs`

AI 修改记录的 Webhook URL 和 Bearer Token 已配置在 `.env.local`，不要写入 Git。

当前状态：

```text
configured: true
tokenConfigured: true
pending: 0
failed: 0
sent: 9
```

### Cursor

用户级配置位于：

```text
C:\Users\hongliang.li\.cursor\hooks.json
```

已接入：

- `beforeSubmitPrompt`：建立基线。
- `afterAgentResponse`：缓存回复。
- `stop`：完成比较并入队。

Cursor 真实修改记录已成功投递。

### ChatGPT / Codex

用户级配置位于：

```text
C:\Users\hongliang.li\.codex\hooks.json
```

配置了 `UserPromptSubmit` 和 `Stop`，但当前 ChatGPT 桌面会话没有执行这两个 Hook。本地 `change-records.log` 没有本次会话的 begin / complete 记录。

当前已确认：

- 新增、修改、删除文件均可被采集器正确识别。
- Webhook 投递正常。
- ChatGPT 模拟事件已成功写入飞书。
- 问题位于 ChatGPT 桌面端没有自动调用 Hook，而不是新文件、Git 比对或飞书工作流。
- `/hooks` 是 Codex CLI 命令，当前桌面版输入框不提供该命令。

需要继续确认：如何让桌面版加载并信任 `~/.codex/hooks.json`；可先在 Codex CLI 中运行 `/hooks` 完成审核，然后重启桌面版、新建任务验收。

## Git 提交记录

主要实现：

- 每 5 秒扫描一次 `D:/project`。
- 自动发现最大深度 5 内的 Git 仓库。
- 比较本地 `refs/heads/*`，发现新 commit 后生成事件。
- 采集仓库、远端地址、分支、父提交、提交类型、作者、标题、说明、文件和增删行。
- 可关联最近 7 天涉及相同文件的 AI 修改事件。
- 使用独立本地队列、重试和失败重放。

相关文件：

- `scripts/lib/commit-records.mjs`
- `scripts/commit-record-worker.mjs`
- `scripts/watch-all.mjs`

Git 提交记录的 Webhook URL 已配置在 `.env.local`；飞书端未开启 Bearer Token。

当前状态：

```text
configured: true
repositoryCount: 27
pending: 0
failed: 0
sent: 1
```

该 Webhook 已在本次交接前配置并重启后台监听，积压提交已成功补发。

监听的是本地 commit，不是 push：

```text
修改文件 → git commit → 最多约 5 秒后采集
                    ↓
                  git push 不会再生成第二条
```

## 飞书字段映射

### AI 修改记录

使用 `scripts/lib/change-records.mjs` 的 `toWebhookPayload()` 输出，字段为中文名称，例如：

- `事件 ID`
- `工具`
- `项目`
- `仓库路径`
- `分支`
- `HEAD 提交`
- `用户需求`
- `修改结果`
- `修改文件`
- `文件数`
- `新增行`
- `删除行`
- `结果状态`
- `采集质量`
- `会话 ID`
- `轮次 ID`
- `完成时间`

### Git 提交记录

| 飞书字段 | Webhook 字段 |
| --- | --- |
| 事件 ID | `event_id` |
| 项目 | `project` |
| 仓库路径 | `repo_path` |
| 远端地址 | `remote_url` |
| 分支 | `branch` |
| 父提交 | `parent_shas` |
| 提交类型 | `commit_kind` |
| 引用变化 | `ref_update_type` |
| 作者 | `author_name` |
| 提交标题 | `commit_subject` |
| 提交说明 | `commit_message` |
| 修改文件 | `changed_files` |
| 文件数 | `changed_file_count` |
| 新增行 | `additions` |
| 删除行 | `deletions` |
| 检测时间 | `detected_at` |
| 提交时间 | `committed_at` |
| 提交 SHA | `commit_sha` |
| 短 SHA | `short_sha` |
| 关联 AI 事件 ID | `related_ai_event_ids` |

## 已知问题

### 1. 多 worker 会重复投递

测试删除文件时，后台常驻 `change-record-worker.mjs` 与手动执行的 `--once` worker 同时读取到同一个 pending 事件，导致飞书收到两次相同 `event_id`。

根因：当前发送流程是“读取 pending → POST → 移到 sent”，发送前没有原子抢占。

建议修复：

```text
pending → 原子 rename 到 processing → POST → sent / pending / failed
```

只有成功抢占事件的 worker 可以发送。飞书工作流继续按 `event_id` 去重作为第二层保护。

### 2. Hook 输入曾出现乱码

`hook-errors.log` 曾出现 BOM / 编码异常导致 JSON 解析失败。`on-change-event.mjs` 已包含部分兼容处理，但 ChatGPT 与 Cursor 的真实载荷仍需继续验收。

### 3. 部分控制台中文乱码

`watch-all.mjs`、`.env.example` 等文件在 PowerShell 默认编码下显示过乱码，需要确认文件真实编码后再统一处理，避免直接根据终端乱码重写内容。

## 常用命令

```powershell
npm run watch:all

npm run records:status
npm run records:dry-run
npm run records:replay

npm run commits:status
npm run commits:dry-run
npm run commits:replay

npm test
```

## 下一步

1. 修复多 worker 原子抢占，避免重复 Webhook。
2. 在 `.env.local` 配置 Git 提交记录 Webhook。
3. 完成飞书“提交记录”新增记录节点字段映射并启用工作流。
4. 解决 ChatGPT 桌面端 Hook 自动触发问题。
5. 分别进行 Cursor、ChatGPT、Git commit 的真实验收。
6. 运行完整测试后再整理并提交当前工作区改动。

## 注意

- 当前工作区已有大量未提交改动，不要覆盖或回退无关文件。
- `.env.local` 包含真实 Webhook Token，不应提交。
- `.local/` 包含队列、日志和测试事件，不应提交。
