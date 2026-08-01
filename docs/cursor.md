# Cursor 集成

Amber 不需要 Cursor 插件。推荐用 `watch:all` 同时监听系统 toast 和 AskQuestion/确认框 UI。

## 推荐：全量监听

1. 确认已在 Windows 开启用户通知访问权限：
   ```text
   Windows 设置 -> 隐私和安全性 -> 通知 -> 用户通知访问
   ```
2. 在 Cursor 终端启动：
   ```powershell
   npm run watch:all
   ```
3. 或通过命令面板：`Tasks: Run Task` -> `Amber: watch all (toast + UI prompts)`

watcher 前台运行，在终端按 `Ctrl+C` 停止。

## AskQuestion：聚焦 vs 失焦

| Cursor 状态 | 系统 toast | watch:all | 推荐补发方式 |
|-------------|-----------|-----------|-------------|
| **失焦**（最小化/切走） | 会弹 `Input needed` | `[toast]` 自动发 `wait` | 无需额外操作 |
| **聚焦**（在前台） | **不弹** toast | 抓不到 | Rule + `notify-ask.mjs` |

### 聚焦时怎么通知

三层方案（建议都开着）：

1. **用户 Hook**（自动）：`C:\Users\hongliang.li\.cursor\hooks.json`  
   监听 `afterAgentResponse` / `stop`，调用 `scripts/hooks/on-cursor-event.mjs`  
   调试日志：`d:\project\Amber\.local\cursor-hook.log`  
   **修改 hooks 后需 Reload Cursor**

2. **Cursor Rule**：Agent AskQuestion 前先 Shell 执行 `notify-ask.mjs`

3. **手动测试**：
   ```powershell
   npm run notify:ask -- "测试 AskQuestion 通知"
   ```

> AskQuestion 本身不触发 preToolUse/postToolUse（Cursor 已知 bug）。

## 测试 AskQuestion

```powershell
npm run watch:all -- --dry-run
```

1. 让 Agent 用 AskQuestion 问你 1 个问题
2. 看终端 `[ui]` 是否出现 `等你回答` / `需要你确认`
3. 若无输出，最小化 Cursor 后再问一次，看 `[toast]` 是否捕获 `Input needed`
4. 探测 UI：`node scripts/watch-ui-prompts.mjs --probe`

去掉 `--dry-run` 后，飞书/手环应收到「需要接管」类通知。

## 分拆监听

只监听系统 toast：

```powershell
npm run watch:notifications
```

只监听内部确认框 / AskQuestion UI：

```powershell
npm run watch:ui-prompts
```

`Input needed`、`Command approval` 类 toast 会发 `wait`；普通 Done toast 发 `info`。

## 可用任务

打开 Cursor 命令面板，选择 `Tasks: Run Task`：

```text
Amber: watch all (toast + UI prompts)
Amber: watch Codex/Cursor notifications
Amber: watch Codex/Cursor UI prompts
Amber: test notification
Amber: status done
Amber: status wait
Amber: run command with notification
```

## 手动用法

测试飞书和手环链路：

```powershell
npm run notify:test
```

包装真实命令：

```powershell
npm run run:notify -- --name "测试" -- npm test
npm run run:notify -- --name "构建" -- npm run build
```

命令开始会记录 `running`，成功会记录并通知 `done`，失败会记录并通知 `error`。

本地验证（不发飞书）：

```powershell
npm run run:notify -- --name "本地验证" --no-notify -- node -e "process.exit(0)"
```
