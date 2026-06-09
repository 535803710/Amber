# Codex 集成

Codex 支持两类自动通知能力，也保留手动命令。

## 1. 系统通知（v1）

Codex 产生的 **Windows 系统 toast** 可由 watcher 自动捕获并转发到飞书/手环。

推荐与 UI 监听一起启动：

```powershell
npm run watch:all
```

只监听 toast：

```powershell
npm run watch:notifications
```

常用参数：

```powershell
node scripts/watch-notifications.mjs --apps Codex,Cursor
node scripts/watch-notifications.mjs --dry-run
node scripts/watch-notifications.mjs --probe --apps "*"
```

转发规则：

```text
Input needed / Command approval -> wait（需要接管）
其他 toast -> info（提示）
```

依赖 Windows 用户通知访问权限：

```text
Windows 设置 -> 隐私和安全性 -> 通知 -> 用户通知访问
```

## 2. 内部确认框 / AskQuestion（v2）

Codex/Cursor 内部弹窗、AskQuestion 选项卡 **不是** Windows 系统通知，需要 UI Automation watcher：

```powershell
npm run watch:ui-prompts
# 或与 toast 一起
npm run watch:all
```

命中确认或提问关键词后，会发送：

```powershell
node scripts/status.mjs wait "Codex/Cursor 等你回答：<摘要>" --force
node scripts/status.mjs wait "Codex/Cursor 需要你确认：<摘要>" --force
```

注意：

- 只读监听，不自动点击、不自动批准
- 存在误报/漏报风险，建议与 v1 系统通知监听配合使用

## 手动记录状态

仍可直接用命令记录状态：

开始长任务：

```powershell
npm run status -- running "Codex 正在执行"
```

需要用户确认：

```powershell
npm run status -- wait "需要你确认方案"
```

任务完成：

```powershell
npm run status -- done "Codex 任务完成"
```

任务失败：

```powershell
npm run status -- error "Codex 任务失败"
```

## 包装命令

如果 Codex 要跑一个可执行命令：

```powershell
npm run run:notify -- --name "测试" -- npm test
```

这会保留原命令退出码，方便判断任务是否成功。

## 自动化巡检

Codex 自动化适合做补充巡检，不作为核心触发器。

示例：

```powershell
node scripts/check-status.mjs --stale-minutes 30
```

如果状态长时间停留在 `running`，脚本会发 `wait` 提醒接管。
