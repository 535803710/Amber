# mi-notic

Send short vibecoding status notifications to Feishu, then let the phone and Xiaomi band receive the Feishu notification.

## Setup

1. Create a Feishu custom bot and copy its webhook URL.
2. Copy `.env.example` to `.env`.
3. Fill `FEISHU_WEBHOOK_URL` in `.env`.
4. If Feishu bot signature verification is enabled, also fill `FEISHU_WEBHOOK_SECRET`.

Feishu custom bot guide: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot

## Usage

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
