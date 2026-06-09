# mi-notic

Send short vibecoding status notifications to Feishu, then let the phone and Xiaomi band receive the Feishu notification.

## Setup

1. Create a Feishu custom bot and copy its webhook URL.
2. Copy `.env.example` to `.env`.
3. Fill `FEISHU_WEBHOOK_URL` in `.env`.
4. If Feishu bot signature verification is enabled, also fill `FEISHU_WEBHOOK_SECRET`.

Feishu custom bot guide: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot

## Usage

Send a direct Feishu notification:

```powershell
npm run notify -- test "手环通知链路测试"
npm run notify -- done "Codex 任务完成"
npm run notify -- error "Cursor 构建失败"
npm run notify -- wait "需要你接管确认"
```

Or run the script directly:

```powershell
node scripts/notify.mjs done "Codex 任务完成"
```

Dry run without sending:

```powershell
node scripts/notify.mjs done "Codex 任务完成" --dry-run
```

If signature verification is enabled, dry-run output redacts the generated sign.

Record a vibecoding status and notify only when needed:

```powershell
npm run status -- running "Codex 正在执行"
npm run status -- done "Codex 任务完成"
npm run status -- error "Cursor 构建失败"
npm run status -- wait "需要你接管确认"
```

`status` writes the latest status to `.local/status.json`.

By default, only these statuses send Feishu notifications:

```text
test, done, error, wait, ask
```

`running` and `info` are recorded but do not notify. The same status and message will not notify repeatedly within 5 minutes.

Useful status options:

```powershell
node scripts/status.mjs done "Codex 任务完成" --dry-run
node scripts/status.mjs done "Codex 任务完成" --force
node scripts/status.mjs running "Codex 正在执行" --notify
node scripts/status.mjs done "Codex 任务完成" --no-notify
```

## Message Format

The message is intentionally short for band display:

```text
Vibecoding
完成：Codex 任务完成
```

Supported status types:

```text
test, info, running, done, error, wait, ask
```

Optional status environment:

```text
VIBECODING_NOTIFY_DEDUPE_SECONDS=300
```
