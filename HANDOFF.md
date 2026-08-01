# Amber 当前工作区交接

更新时间：2026-08-01
当前分支：`feature/record-history-pages`
当前 HEAD：`66d5887 docs: 添加 2026-08-01 更新说明，记录 AI 修改和 Git 提交功能`

## 一句话概览

当前工作区正在把 Amber 从“Windows 通知转发器”扩展为“AI 修改记录 + Git 提交记录 + 本地可靠投递 + 健康监控 + 查询控制台”的完整链路。改动尚未提交。

## 当前代码结构

- `scripts/hooks/`：接收 Cursor / Codex 事件，建立 AI 修改轮次 baseline，并在结束时生成变更记录。
- `scripts/lib/change-records.mjs`：AI 修改事件、字段映射、事件去重和本地 outbox。
- `scripts/lib/commit-records.mjs`：扫描配置目录下的本地 Git 仓库、建立分支基线、识别新 commit，并关联近 7 天内相同文件的 AI 事件。
- `scripts/commit-record-scanner.mjs`：独立 Git 扫描入口；未配置 `COMMIT_RECORD_SCAN_ROOTS` 时不扫描。
- `scripts/*-record-worker.mjs`：分别投递 AI 修改记录和 Git 提交记录，支持状态查询、dry-run、失败重放。
- `scripts/lib/file-outbox.mjs`：`pending -> processing -> sent/failed` 的原子抢占、超时恢复和 JSON 原子写入。
- `scripts/lib/health*.mjs`、`scripts/health-monitor-worker.mjs`：运行进程、Hook、baseline、队列、Git 扫描和 Webhook 健康检查，并处理告警/恢复。
- `scripts/start-watch-stack.mjs`：统一启动 toast、UI prompt、AI 修改记录、Git 扫描和健康监控。
- `scripts/dashboard-server.mjs`：控制台 API、配置保存、监听器启停、记录查询、失败重放、健康状态和 baseline 归档。
- `dashboard/`：控制台首页、AI 修改记录页、Git 提交记录页；支持中英文、主题切换和只读分页展示。
- `test/`：AI 修改、Git 扫描、outbox 并发抢占、健康监控、记录列表等测试。

## 当前 Git 工作区改动

### 已修改

- 配置与入口：`.env.example`、`package.json`、`README.md`、`计划.md`、`docs/cursor.md`、`docs/更新说明-2026-08-01.md`、`.vscode/tasks.json`。
- 控制台：`dashboard/app.css`、`dashboard/app.js`、`dashboard/index.html`、`dashboard/records.js`、`dashboard/change-records.html`、`dashboard/commit-records.html`。
- 监听与投递：`scripts/change-record-worker.mjs`、`scripts/commit-record-worker.mjs`、`scripts/dashboard-server.mjs`、`scripts/watch-all.mjs`、`scripts/start-watch-background.ps1`、`scripts/stop-watch-background.ps1`、`scripts/install-autostart.ps1`。
- Hook 与通知：`scripts/hooks/on-change-event.mjs`、`scripts/hooks/on-cursor-event.mjs`、`scripts/notify-ask.mjs`、`scripts/notify-format.mjs`、`scripts/notify.mjs`。
- 核心库与测试：`scripts/lib/change-records.mjs`、`scripts/lib/commit-records.mjs`、`scripts/lib/record-listing.mjs`、`scripts/lib/settings.mjs`、`scripts/lib/watcher-control.mjs`、`test/change-records.test.mjs`、`test/record-listing.test.mjs`。
- 本文件：`HANDOFF.md`。

### 已删除

- `.cursor/rules/mi-notic-askquestion.mdc`
- `mi-notic.bat`

### 未跟踪

- `.cursor/rules/amber-askquestion.mdc`
- `amber.bat`
- `amber-author-test.txt`、`amber-hook-test.txt`
- `docs/琥珀计划.md`
- `scripts/commit-record-scanner.mjs`
- `scripts/health-monitor-worker.mjs`
- `scripts/start-watch-stack.mjs`
- `scripts/lib/file-outbox.mjs`、`scripts/lib/health-alerts.mjs`、`scripts/lib/health-reset.mjs`、`scripts/lib/health.mjs`
- `test/health.test.mjs`、`test/smoke-marker.txt`

`amber-*.txt` 和 `test/smoke-marker.txt` 看起来是验证产生的临时标记，提交前需要确认是否保留。旧的 `mi-notic` 文件删除与 `amber` 重命名需要一起检查，避免遗留旧入口或破坏用户已有快捷方式。

## 已实现的行为

1. AI 修改记录：任务开始保存临时 Git index baseline，任务结束比较 tree；只在实际文件变化时入队，覆盖新增、修改、删除、重命名、暂存和未跟踪文件。
2. Git 提交记录：只扫描 `COMMIT_RECORD_SCAN_ROOTS` 指定目录内、最大深度 5 的本地 Git 仓库；首次发现只建立基线，后续新本地 `git commit` 才产生事件，不监听 `push`。
3. 两条链路使用独立队列和 Webhook 配置，均支持 Bearer token、失败重试、失败重放、dry-run 和状态查询。
4. outbox 使用原子 rename 抢占 `pending` 项，支持 `processing` 租约超时恢复，已覆盖双 worker 并发不重复投递的测试。
5. 健康监控检查监听进程、Hook、残留 baseline、投递队列、Git 扫描延迟和仓库错误；控制台可归档残留 baseline，但不会删除已发送记录或 Git 历史。
6. 控制台提供首页状态、AI 修改记录页、Git 提交记录页、状态筛选/分页、主题切换、中英文切换和监听器启停。
7. Windows 自启动脚本已切换到 Amber 命名，并兼容清理旧的 `mi-notic` 任务/快捷方式。

## 配置边界

敏感配置只放在本地 `.env.local`，不要提交：

- `FEISHU_WEBHOOK_URL`：普通通知。
- `FEISHU_CHANGE_WEBHOOK_URL` / `FEISHU_CHANGE_WEBHOOK_TOKEN`：AI 修改记录。
- `FEISHU_COMMIT_WEBHOOK_URL` / `FEISHU_COMMIT_WEBHOOK_TOKEN`：Git 提交记录。
- `COMMIT_RECORD_SCAN_ROOTS`：分号分隔的绝对扫描目录；未配置时 Git 扫描关闭。
- `AMBER_HEALTH_*`：健康检查间隔、阈值和告警重复周期。

`.local/` 包含队列、日志、baseline、PID 和运行状态，不应提交。控制台记录页只返回展示投影，不读取或暴露 Webhook 响应、token 等内部字段。

## 常用命令

```powershell
npm test
npm run watch:all
npm run dashboard
npm run health:status
npm run records:status
npm run records:dry-run
npm run records:replay
npm run commits:status
npm run commits:dry-run
npm run commits:replay
```

控制台默认地址：`http://127.0.0.1:3847`。

## 当前验证结果

- `npm test`：41 个测试全部通过。
- `git diff --check`：未发现补丁解析错误；报告了 `docs/cursor.md`、`scripts/install-autostart.ps1`、`计划.md` 中的行尾空白，暂未处理。
- 测试运行会生成/更新本地验证状态，提交前应重新检查 `git status --short`，不要把 `.local/` 或临时标记带入提交。

## 建议后续顺序

1. 先确认 `amber-*.txt`、`test/smoke-marker.txt` 是否只是临时文件，并确认 `mi-notic` 删除/Amber 重命名是否符合预期。
2. 用真实 Cursor、Codex/ChatGPT 和本地 Git commit 各跑一轮，核对事件 ID、文件统计、关联关系和飞书字段。
3. 检查 `.env.local` 的两条记录 Webhook 和 `COMMIT_RECORD_SCAN_ROOTS`，确认 token 没有进入 Git。
4. 再决定是否单独清理行尾空白、提交本次改动，以及是否需要补充真实桌面 Hook 的验收记录。

## 注意事项

- 不要覆盖或回退其他未提交改动；当前工作区是多条功能线的合并状态。
- 不要把完整 diff、源代码或真实 Webhook 凭证写入记录或文档。
- AI 修改记录目前依赖客户端 Hook 是否实际触发；桌面客户端不触发 Hook 时，Amber 本地 worker 本身无法补齐该事件。
