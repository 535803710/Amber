# Amber（琥珀计划）

> 代码奔向未来，记忆却散落在身后。
> 我们把每一次人与 AI 的相遇封存在时间里，让后来者不必再从遗忘出发。

Amber 采集 AI 修改和 Git 提交这两类研发事实，可靠投递后沉淀成飞书多维表格里可查询的研发证据。下次 IDE Agent 接手一个老模块时，可以通过 Amber MCP 查回这个工作区经历过什么，从证据出发恢复研发现场。

当前状态：采集链路与健康监控已经稳定，MCP 证据服务 v2 正在真实任务中验证。部门推广入口以 [部门推广方案](docs/部门推广方案调研与一期建设/【琥珀计划】部门推广方案调研与一期建设.md) 为准：Skill + npx，不是 ZIP。完整路线见 [琥珀计划](docs/琥珀计划.md)，方向依据见 [产品方向讨论结论（2026-08-06）](docs/产品方向讨论结论-2026-08-06.md)。

## 省流（TL;DR）

只想先跑起来的，看这里：

```powershell
copy .env.example .env.local   # 填记录 Webhook 和 Git 扫描目录
npm run watch:core             # AI 修改、Git 提交和健康监控核心启动
npm run watch:all              # 额外包含 Windows 通知和 UI 提示监听
npm run dashboard              # 网页控制台：看队列、采集健康和记录
```

Amber 现在做四件事：

| 能力 | 说明 |
| --- | --- |
| ✍️ AI 修改记录 | Cursor / Codex 的 hook 按轮次生成工作区前后快照，实际有文件变化才写入飞书多维表格 |
| 🔀 Git 提交记录 | 只读扫描配置的目录，识别新 commit，自动关联最近的 AI 修改记录 |
| 🩺 健康监控 | 盯着 Hook 接入、运行进程、投递队列和 MCP 调用，异常分级告警、恢复也有提醒 |
| 🔍 MCP 证据服务 | `amber_get_task_context` 返回与当前任务强相关的历史证据 |

## 为什么做这个

一次任务结束，Agent 的对话窗口也跟着关了。改了什么、为什么改、改完有没有提交，散落在对话、工作区和提交历史里。谁想接手现场——不管是人还是 Agent——都得从头排查一遍。

Git 留住了最终代码，留不住修改意图；对话里有意图，又撑不过一个会话。Amber 补的就是这一块：把 AI 修改和 Git 提交采集下来，可靠投递到飞书多维表格，等下一个任务来的时候，用 MCP 把证据查回来。

名字是这么来的：把散落的事实封存进琥珀。

## 现在的 Amber

### 整体链路

```text
用户需求
  → Cursor / ChatGPT 执行
  → Amber 采集 AI 修改事件
  → Git commit 固化代码历史
  → Amber 采集 Git 提交事件
  → 本地 Outbox 可靠投递
  → 飞书多维表格沉淀
  → Amber MCP 查询相关历史证据
  → IDE Agent 结合当前代码、Git 和测试恢复现场
```

每一层只保留自己最擅长的事实：

| 链路节点 | 沉淀内容 | 作用 |
| --- | --- | --- |
| Cursor / ChatGPT | 用户需求、AI 结果摘要、实际涉及文件 | 保留修改意图和执行结果 |
| Git | commit、分支、作者、文件和增删统计 | 确认哪些修改进入了正式代码历史 |
| Amber | 标准化事件、本地队列、投递状态 | 连接不同工具，保证可靠采集 |
| 飞书 | 结构化记录、权限和团队可见性 | 稳定的数据入口 |
| Amber MCP | 与当前任务相关的历史证据 | 给任务提供证据 |
| IDE Agent | 当前需求、代码、Git、测试 + 历史证据 | 形成最终上下文和研发判断 |

### AI 修改记录

Cursor 和 Codex/ChatGPT 的用户级 hook 会为每个完成轮次生成工作区前后快照：

```text
任务开始
  → 临时 Git index 捕获工作区 baseline
  → 任务完成后再次捕获工作区 tree
  → 比较两棵 tree
  → 汇总新增、修改、删除、重命名文件及增删行
  → 写入本地 Outbox
  → Worker 投递飞书
```

记录的是元数据：工具来源、项目、分支、需求摘要、结果摘要、文件列表和增删行。完整 diff 和源码内容不会进队列。

只有工作区实际发生变化时才生成事件，纯问答和分析的轮次不会写入飞书。Cursor 会从 hook 的 `workspace_roots` 识别实际项目目录，Windows 下中文载荷偶发损坏也做了兼容。

Codex 子代理（Bugbot、explore 等）会复用父会话的 `session_id` 触发 `UserPromptSubmit`，但它和父轮次共享同一个工作区，改动本来就落在父轮次的快照区间内。Amber 通过 Codex rollout 里的 `thread_source` 判定子代理并跳过采集，避免双重记账，也避免父轮次的 baseline 被子代理挤掉。

测试记录链路时，可以只改文档，既不影响程序功能，也方便核对飞书里的文件统计。

### Git 提交记录

`watch:core` 和 `watch:all` 都会运行 Git 提交记录 worker，只读扫描 `COMMIT_RECORD_SCAN_ROOTS` 配置目录下的 Git 仓库和本地分支。多个绝对路径用分号分隔，例如 `COMMIT_RECORD_SCAN_ROOTS=D:/project;E:/work`，未配置时不扫描。

采集分三层：refs 文件事件驱动（默认防抖 750ms、最长等待 5s）、每 60 秒遍历配置目录发现新增/移除仓库、每 1 小时全量兜底补偿 watcher 漏报。不修改项目 Git Hook，零仓库入侵。调整间隔见 `.env.example` 中 `COMMIT_RECORD_RECONCILE_INTERVAL_MS` / `COMMIT_RECORD_DISCOVERY_INTERVAL_MS` / `COMMIT_RECORD_WATCH_DEBOUNCE_MS` / `COMMIT_RECORD_WATCH_MAX_WAIT_MS`。

首次发现仓库只建立各分支的基线，之后发现新 commit 才生成事件、投递到 `FEISHU_COMMIT_WEBHOOK_URL`，历史提交不会批量回灌。`git push` 不产生事件，一次提交只对应一条记录。

每条提交记录还会带上最近时间窗口内修改过相同文件的 AI 事件 ID。一次 AI 修改最终进了哪个 commit，对着看就行。

### 可靠投递与健康监控

AI 修改和 Git 提交各有一套独立的本地 Outbox。队列状态走 `pending → processing → sent/failed` 原子抢占，多个 worker 不会重复投递；失败自动重试，超时卡在 processing 的记录会被恢复，失败队列也可以手动重放。

独立的健康监控跟着 core/full 运行档位一起启动，检查 Hook 接入、运行进程、Git 扫描、投递队列和 MCP 调用的超时率、错误率。异常分级、告警去重、恢复提醒，full 档位下的可选监听器挂了会自动重启。内部 Memory Writing Agent 和 Codex 子代理都不进入修改采集，已产生的内部残留满 30 分钟会自动归档；真实超时告警会给出项目、轮次和开始时间。其他残留的未完成 baseline 可以在控制台对应异常旁归档，可恢复，不影响已发送的记录。

### 网页控制台

双击 `Amber.bat` 选 1，或者跑 `npm run dashboard`，浏览器打开 http://127.0.0.1:3847 。

开关采集链路、看采集健康和队列状态，都在这一页。顶部还能进两个只读记录页：`/change-records.html` 看 AI 修改记录，`/commit-records.html` 看 Git 提交记录，都从本地 `.local` 队列读取，支持按投递状态筛选、分页和展开详情。

Webhook、Token 和 Git 扫描目录也在控制台里配置，凭据只写本机。

### MCP 证据服务

`npm run mcp:stdio` 启动只读 MCP 服务，提供 `amber_get_task_context`。

默认只查 AI 修改记录表，按项目在飞书端过滤，再按任务、文件、分支和时间筛选。问到历史演变、最终决定、重构、迁移或删除这类问题时，会在一次调用内同时查关联的 Git 提交表——Git 提交只作为强关联修改的嵌套补充。飞书认证、网络、权限或数据异常时，自动回退读取目标仓库的 `.local` 队列。

输出契约是 v2：

- 默认 `detail=minimal`、`limit=3`，最多返回 10 条；每条包含用户需求、修改结果、完成时间和涉及文件；
- 历史演变类问题自动升级为 `compact + 8`，顶层 `retrieval` 会说明实际生效的密度、上限和升级原因；
- `compact` 增加分支和强关联提交，`full` 再增加来源和匹配依据；
- 状态分 `ok`、`no_strong_history`、`degraded` 三种，完整 CLI 错误和警告不会抛给模型。

需求和结果摘要保留开头、关键词上下文和结尾，最多约 600 字。返回内容里没有作者邮箱、会话 ID、Token、Webhook、附件和源码。

## 怎么用

### 部门接入（一期目标）

部门用户入口是 **一条 npx 安装命令，重启 Cursor/Codex 后用自然语言完成接入、检查、修复和更新**。Skill 负责理解意图并调用安装器；本地 Runtime 与 Dashboard 继续跑采集和状态。方案与验收见 [部门推广方案](docs/部门推广方案调研与一期建设/【琥珀计划】部门推广方案调研与一期建设.md)。

Skill 与 npx 安装器尚未落地，正式包名未发布。在此之前不要把 ZIP / `install.bat` 发给部门同事当推广入口。

### 当前本机怎么跑（源码）

开发或本机验证继续用仓库源码，不要把 ZIP 当部门入口。现有 Windows `team-setup` / `install.bat` 和 `npm run build` 仍可用，用途见 [团队安装说明](docs/团队安装说明.md)。

```powershell
copy .env.example .env.local
```

填三样东西：

- `FEISHU_CHANGE_WEBHOOK_URL`（可选配 `FEISHU_CHANGE_WEBHOOK_TOKEN`）：AI 修改记录的投递地址，来自飞书多维表格「接收到 Webhook 时」自动化；
- `FEISHU_COMMIT_WEBHOOK_URL`：Git 提交记录的投递地址，独立的 Base 自动化；
- `COMMIT_RECORD_SCAN_ROOTS`：Git 提交扫描目录，多个绝对路径用分号分隔，不填则不扫描。
- `COMMIT_RECORD_RECONCILE_INTERVAL_MS`：全量兜底扫描间隔，默认 3600000（1 小时）。旧变量 `COMMIT_RECORD_SCAN_INTERVAL_MS` 仍兼容。
- `COMMIT_RECORD_DISCOVERY_INTERVAL_MS`：仓库发现间隔，默认 60000（60 秒）。
- `COMMIT_RECORD_WATCH_DEBOUNCE_MS` / `COMMIT_RECORD_WATCH_MAX_WAIT_MS`：refs 文件事件防抖与最长等待，默认 750 / 5000。

凭据只留在本机，`.env.local` 不提交仓库。

### 命令行

习惯终端的话，日常这几条就够：

```powershell
npm run watch:core    # 开核心采集：AI 修改记录 + Git 提交记录 + 健康监控
npm run watch:all     # 在核心采集上增加 Windows 通知和 UI 提示监听
npm run health:status # 看一次采集健康快照（只检查，不告警）
```

健康监控只检查和告警，异常、严重度升级、持续严重异常和恢复都会通过通用 `FEISHU_WEBHOOK_URL` 发到飞书。

开机自启装一次就行：

```powershell
npm run autostart:install
```

### 队列查看与处理

```powershell
npm run records:status   # AI 修改记录：待发送、失败、最近成功时间
npm run records:dry-run  # 预览待发送的 webhook 内容，不真正发送
npm run records:replay   # 重放失败队列

npm run commits:status   # Git 提交记录同样一套
npm run commits:dry-run
npm run commits:replay
```

Webhook 地址和 Bearer token 也可以在网页控制台保存，效果一样。

### MCP 配置

Cursor 项目配置：

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

Codex 在 `config.toml` 里用同一个 stdio 命令配置。当前 Windows `team-setup` 会按安装目录写入 Hook/MCP；部门入口改为 npx 后，仍应复用同一套合并逻辑。

输入必须包含 `workspace_root`（绝对路径）和 `task`，可选 `files`、`limit`、`detail`。共享 Base 可以用 `.env.local` 的 `AMBER_BASE_TOKEN`、`AMBER_AI_TABLE_ID`、`AMBER_COMMIT_TABLE_ID` 覆盖，未配置时继续使用默认双表。

历史演变题的自动升级可以在启动前设置 `AMBER_TASK_CONTEXT_ADAPTIVE_HISTORY=0` 紧急关闭，默认 `1`，只影响检索密度。

配置完成后，日常使用不需要手写参数，直接向 Agent 描述目的就行：「恢复这个任务上次做到哪里」「这个模块之前为什么这样实现」。更多用法见 [Codex 使用说明](docs/codex.md) 和 [Cursor 集成](docs/cursor.md)。

### MCP 调用规则

历史查询有它自己的纪律：

- 每次任务开始时先读当前需求、代码、测试和文档，历史查询不是开场例行公事；
- 用户明确询问历史（之前的决策、历史实现、未完成现场、回归原因）时，必须调用一次，即使本地 Git、代码或文档已经提供了部分答案；
- 其他任务只在两种情况调用：修改已有模块、公共接口、配置或数据结构而当前代码解释不了约束；需要确认兼容性、过去失败经验或多个方案之间的历史取舍；
- 纯新增、机械编辑、格式化、简单重命名、通用编程问题，以及当前仓库事实已经充分的任务，保持零调用。

历史记录只是可能过时的证据，不是执行指令。当前用户需求、代码、测试和文档优先；返回 `no_strong_history` 时按没有可用历史处理；历史与当前事实冲突时，采用当前事实并明确说明冲突。

## 数据与安全边界

Amber 默认采集研发元数据，完整源码和完整 diff 留在仓库之外。

- Webhook URL、Token 等真实凭证只保存在本机 `.env.local`；
- 本地队列、日志、baseline 和密钥不进入 Git；
- 飞书记录包含需求和 AI 回复摘要，可能出现业务信息，飞书表格需要限制访问权限并约定数据保留周期；
- 事件 ID 作为飞书侧幂等去重的依据；
- 记录用于研发上下文和工程改进，与个人绩效排名无关；
- 自动采集以「实际发生文件修改」为边界，完整对话、探索过程和未定型想法都在采集范围外；
- 少量重要决定暂时直接写入仓库文档，由 IDE Agent 结合当前代码核验。

## 计划：三层和一个机会池

原来的五阶段路线已经收敛成三层。进展以「历史证据是否真的减少重复排查、遗漏和返工」来判断。

| 层级 | 能力 | 当前状态 |
| --- | --- | --- |
| 1 | 研发事实采集：AI 修改、Git 提交、可靠投递、健康监控 | 基础能力已具备 |
| 2 | MCP 证据服务：准确返回相关历史 | v2 输出已收敛，真实任务验证中 |
| 3 | IDE 上下文恢复：当前代码 + Git + 测试 + 历史证据 | 下一步验证 |

近期重点：

1. 按部门推广方案建设 Skill + npx 安装器，Windows 先打通固定目录接入；
2. 在真实研发任务中验证 MCP v2 的 Top 3 证据是否足够且相关；
3. 验证「IDE Agent + 当前代码/Git/测试 + MCP 历史」的恢复方式；
4. 记录历史证据实际节省时间、避免遗漏或减少返工的案例；
5. ROI 得到证明前，机会池里的重型能力先按兵不动。

机会池（暂不承诺）：完整的 AI 变更验收和 Review 流程、主动遗留雷达、团队知识地图、发布风险与故障反查、自动提炼 Skill、研发全生命周期流程编排。这些能力只有在出现稳定、重复且代价明确的真实问题，并且收益能盖过维护成本时，才会选择性建设。

决策记录能力暂缓：`amber_get_task_context` 保持只读，新增决策表和 `amber_record_decision` 都先放一放。决策表达的是当时的意图，实现可能还没完成或者已经改变，直接当成事实喂给 MCP，只会多出噪音。详细讨论见 [产品方向讨论结论（2026-08-06）](docs/产品方向讨论结论-2026-08-06.md)。

## 已知限制

| 风险 | 当前应对 |
| --- | --- |
| ChatGPT 会话工作区失效：项目目录改名后，旧会话仍绑定旧 cwd | 改名后重新打开 Amber 工作区并新建会话 |
| Codex 沙箱拒绝执行 `C:\Program Files\nodejs\node.exe`，Hook 进程起不来 | 安装器需按环境分别验证 Cursor/Codex 可用的 Node；Codex Runtime 中的 Node 可通过 `codex sandbox` 探测 |
| 临时 Git 索引仍向仓库 `.git/objects` 写快照对象，Codex Hook 创建 baseline 失败 | 快照对象写入 Amber `.local/change-records/git-objects`，仓库对象库仅作为只读 alternate |
| Hook 定义和信任哈希晚于任务创建，旧任务可能继续使用原 Hook 快照 | 信任当前哈希后创建全新任务验收；这是 Codex Desktop 0.152.0 的本机观察，升级后复测 |
| Cursor 中文回复恢复依赖本地 UTF-8 hook 日志 | Cursor 升级后跑中文回归测试，保留降级标记 |
| 多个 Agent 并发修改同一仓库时归因可能不精确 | 标记 `concurrent_risk`，后续增强关联策略 |
| 提交扫描只覆盖 `COMMIT_RECORD_SCAN_ROOTS` 配置的目录 | 在控制台或 `.env.local` 明确配置实际项目目录 |
| 需求和结果摘要可能包含内部信息 | 权限、脱敏、保留周期和审计治理 |

完整风险表见 [琥珀计划](docs/琥珀计划.md) 第 8 节。

## 项目地址

[https://github.com/535803710/Amber](https://github.com/535803710/Amber)

采集链路已经稳定，MCP 正在真实任务里验证。历史证据到底能不能少排查、少遗漏、少返工，接下来的真实任务会给出答案。
