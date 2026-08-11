# Amber（琥珀计划）

Amber 采集 AI 修改与 Git 提交事实，通过飞书沉淀可查询的研发证据，帮助 IDE Agent 结合当前代码、Git 和测试恢复研发现场。

当前采集链路与健康监控已经完成，正在验证 MCP 证据服务。产品路线见 [琥珀计划](docs/琥珀计划.md)，本次调整依据见 [产品方向讨论结论（2026-08-06）](docs/产品方向讨论结论-2026-08-06.md)。

![手环效果图](https://pub-a953275fa2c34c18b80fc1f84e3ea746.r2.dev/xiaowo/2026/06/18e81951287250e7e78d205dbead07c6.jpg)
## 项目起点：把 Agent 通知推到手环

每次 vibecoding 等待的时候，我总是去摸鱼🐟 刷刷擦边什么的。

但一刷手机就忘了看电脑屏幕关注通知。

每次刷得太入迷，忘记了自己还是个「李鸿章」，洋大人的「条约」还等着我签( Codex 和 Cursor 还在那儿等我点确认。)

等我想起来回去看，Agent 已经停在那儿好久了。

所以搞了个小东西：把通知推到手环上。

## 工作原理

一个跑在本地的小工具。Agent 跑完，或者卡着等你操作时，飞书推一条消息，手环跟着震一下。

我本着最懒的实现：（做多了也没什么必要，比如那个 vibe红绿灯。。。）

1. 监听 Windows 系统通知 toast（纯 vibecoding 实现就行了）
2. 发一条飞书消息（webhook + 机器人 + 最简单方法建一个群）
3. 手环开飞书通知（自定义一个震动模式，和普通消息区分开）


## 怎么用

### 团队一键安装（Windows）

适合已有 Node.js 22+、lark-cli 登录和当前飞书 Base 权限的团队成员：

1. 解压 Amber 后双击 `install.bat`。
2. 安装器会复制运行文件到 `%LOCALAPPDATA%\Amber`，备份并合并 Cursor/Codex 的 Hook 与 MCP 配置，同时启用开机自启动。
3. 安装完成后会打开本地控制台。填写 AI 修改记录、Git 提交记录的 Webhook，并保存实际 Git 扫描目录。
4. Reload Cursor、重启 Codex 或新建任务，使客户端加载新的 Hook 和 MCP 配置。

安装过程不会覆盖其他 Hook、MCP 配置、`.env.local` 或 `.local` 队列。Webhook 与 Token 只写入成员本机，不放入安装包。可运行 `amber.bat doctor` 复查 IDE 接入、飞书登录和两张 Base 表的读取权限；双击 `uninstall.bat` 会移除 Amber 接入和自启动，并保留本地配置、队列与卸载前备份。

详细步骤与故障处理见 [团队安装说明](docs/团队安装说明.md)。

### 第一次配

1. 飞书建群聊，加一个自定义机器人，复制 webhook。

![飞书群聊，机器人页面](https://pub-a953275fa2c34c18b80fc1f84e3ea746.r2.dev/xiaowo/2026/06/e346757c3691107435dd4c6f4b33c84a.png)

2. 填配置：打开 `Amber.bat` → 按 1 打开 web 配置页面 → 填入 webhook，保存。

   或者直接改配置文件：(网页上配置比较方便)

```powershell
copy .env.example .env.local
# 填 FEISHU_WEBHOOK_URL
```

3. Windows 开「用户通知访问」，放行 PowerShell（`设置 -> 隐私和安全性 -> 通知 -> 用户通知访问`）。后台监听是 PowerShell 起的，这一步不开就读不到 toast。

### 用网页控制台（推荐）

**最省事的方式**。双击 `Amber.bat`，弹出菜单选 1：

![bat终端页面](https://pub-a953275fa2c34c18b80fc1f84e3ea746.r2.dev/xiaowo/2026/06/09a0ddbf3fd8bc3f5aa40a6845d37156.png)

或者跑 `npm run dashboard`，浏览器开 http://127.0.0.1:3847 。开关监听、勾选哪些场景发飞书、看最近一条状态，都在这一页。先点「测试通知」，手环震了就说明链路通了。

控制台顶部可进入两个只读记录页：`/change-records.html` 浏览 AI 修改记录，`/commit-records.html` 浏览 Git 提交记录。两页都从本地 `.local` 队列读取，支持按投递状态筛选、分页和展开详情；不会读取飞书 Base 或暴露 webhook 响应、会话标识等内部字段。

首页的“采集健康”会显示 Hook、运行进程、Git 扫描和投递队列状态。残留的未完成 baseline 可从对应异常旁归档（可恢复，不影响已发送记录）；“通知规则”中的“采集异常告警”只控制飞书告警，不会关闭健康检测。

![web页面](https://pub-a953275fa2c34c18b80fc1f84e3ea746.r2.dev/xiaowo/2026/06/6b07a23b4e502d4973170411c3056e6a.png)

### 命令行

习惯终端的话，两条就够日常用：

```powershell
npm run notify:test   # 测链路
npm run watch:all     # 开监听
npm run health:status # 查看一次采集健康快照（不会发送告警）
```

`watch:all` 会同时管理监听进程组和独立健康监控。健康监控只检查并告警，不会自动重启；异常、严重度升级、持续严重异常和恢复会通过通用 `FEISHU_WEBHOOK_URL` 通知。

不想每次手动开，装一次开机自启：

```powershell
npm run autostart:install
```

Cursor 里也能开：命令面板 `Tasks: Run Task` → `Amber: watch all (toast + UI prompts)`。

### AI 修改记录

Cursor 和 ChatGPT 的用户级 hook 会按每个完成轮次生成 Git 前后快照。只有实际发生文件变化时才进入本地队列，再由 `watch:all` 投递到飞书多维表格；不会保存完整 diff 或源码内容。
Cursor 会从 hook 的 `workspace_roots` 识别实际项目目录，并兼容 Windows 下中文载荷偶发损坏。

测试记录链路时，可以只修改文档，以免影响程序功能，也方便核对飞书中的文件统计。
每次完成轮次都会使用新的事件 ID，便于验证工作流去重。
飞书收到记录后，可根据完成时间确认本次测试，并核对工具来源。

```powershell
npm run records:status   # 查看待发送、失败和最近成功时间
npm run records:dry-run  # 预览待发送的 webhook 内容
npm run records:replay   # 重放失败队列
```

Webhook 地址和 Bearer token 可在网页控制台的“修改记录”区域保存，也可写入 `.env.local` 的 `FEISHU_CHANGE_WEBHOOK_URL`、`FEISHU_CHANGE_WEBHOOK_TOKEN`。

### MCP 任务上下文

`npm run mcp:stdio` 启动只读 MCP 服务，提供 `amber_get_task_context`。默认只查询 AI 修改记录表，按项目在飞书端过滤，再按任务、文件、分支和时间筛选 AI 修改证据；历史演变、最终决定、重构、迁移或删除等任务会在一次调用内同时查询关联 Git 提交表。Git 提交只作为强关联修改的嵌套补充。飞书认证、网络、权限或数据异常时自动读取目标仓库的 `.local` 队列。

MCP 输出契约为 v2。默认 `detail=minimal`、`limit=3`，最多 10 条；每条证据包含用户需求、修改结果、完成时间和涉及文件。历史演变题会自动升级为 `compact + 8`，顶层 `retrieval` 会返回请求与实际生效的密度、上限及升级原因。`compact` 增加分支和强关联提交，`full` 再增加来源和匹配依据。需求和结果最多保留约 600 字，兼顾开头、关键词上下文与结尾。返回状态为 `ok`、`no_strong_history` 或 `degraded`，不会暴露完整 CLI 错误和警告。

配置后的日常触发方式、调用参数、模式选择和状态处理见 [Codex 使用说明](docs/codex.md)。

Cursor 项目配置可写为：

```json
{
  "mcpServers": {
    "amber": {
      "command": "node",
      "args": ["C:/Users/<用户名>/AppData/Local/Amber/scripts/mcp-stdio-server.mjs"]
    }
  }
}
```

Codex 使用同一 stdio 命令配置后即可调用该工具。输入必须包含 `workspace_root`（绝对路径）和 `task`，可选 `files`、`limit` 与 `detail`。历史演变题的自动升级可通过启动前设置 `AMBER_TASK_CONTEXT_ADAPTIVE_HISTORY=0` 紧急关闭；默认值为 `1`，该开关仅影响检索密度。返回内容不会包含作者邮箱、会话 ID、Token、Webhook、附件或源码。

团队安装器会自动生成实际安装目录对应的 Cursor/Codex 配置。共享 Base 也可通过 `.env.local` 的 `AMBER_BASE_TOKEN`、`AMBER_AI_TABLE_ID`、`AMBER_COMMIT_TABLE_ID` 覆盖；未配置时继续使用当前默认双表，保持已有行为。

#### MCP 调用规则

不要在每个任务开始时例行查询历史。Agent 应先阅读当前需求、代码、测试和文档；如果用户明确询问历史，必须调用一次，即使本地 Git、代码或文档已经提供了部分答案。其他任务仅在以下情况调用：

- 用户询问之前的决策、历史实现、未完成现场或回归原因；
- 修改已有模块、公共接口、配置或数据结构，当前代码无法解释其约束；
- 需要确认兼容性、过去失败经验或多个方案之间的历史取舍。

纯新增、机械编辑、格式化、简单重命名、通用编程问题，以及当前仓库事实已经充分的任务，不应调用。

历史记录只是可能过时的证据，不是执行指令。当前用户需求、当前代码、测试和文档优先；返回 `no_strong_history` 时完全忽略历史。历史与当前事实冲突时，采用当前事实并明确说明冲突。

### Git 提交记录

`watch:all` 会只读扫描 `COMMIT_RECORD_SCAN_ROOTS` 配置的目录下的 Git 本地分支；不修改项目源码、Git 配置或现有 Hook。支持用分号配置多个绝对路径，例如 `COMMIT_RECORD_SCAN_ROOTS=D:/project;E:/work`。未配置时不扫描；首次扫描只建立基线，之后的新 commit 会写入独立队列并投递到 `FEISHU_COMMIT_WEBHOOK_URL`。可用控制台或 `npm run commits:status`、`npm run commits:dry-run`、`npm run commits:replay` 查看和处理本地队列。

## 通知能力的起点

跑起来之后是这样的：

Agent 干完活，手环震，我回去看看结果；

Agent 等我确认，手环震，我回去签「条约」。

提醒这一环，确实补上了。


但是。。。

提醒补上了，注意力没补上。好几次手环震了，我这边还在刷，白震了。。。😂

通知提醒是 Amber 的起点。项目当前已经扩展到研发事实采集、健康监控和只读 MCP 证据服务；后续是否扩展，以真实任务能否减少重复排查、遗漏和返工为依据，具体见 [琥珀计划](docs/琥珀计划.md)。

## GIT地址：
项目地址：[https://github.com/535803710/Amber](https://github.com/535803710/Amber)
