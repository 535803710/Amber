# Amber Windows MVP 第二台机器试测问题记录

记录日期：2026-09-03

状态：第二轮干净 Windows 复测中，新增问题待分析

范围：杨金辉的 `Amber-team-v1.4.0-mvp.1` 首轮测试与程淑宇的 `Amber-team-v1.4.0-mvp.2` 干净机器复测

## 一、测试现场

- 第一次测试人员：杨金辉，执行 `mvp.1` 首轮安装和实际使用测试。
- 第二次测试人员：程淑宇，使用此前未安装过 Amber 的 Windows 机器执行 `mvp.2` 干净安装测试。
- 当前安装状态：杨金辉和程淑宇的 Windows 机器均已安装 Amber。
- 已提供 AI 修改记录页面截图。截图包含个人邮箱，仅用于本次核对，未复制进仓库。
- 已提供该机器的 `.local` 文件夹副本，仅做只读检查。
- 日志显示 Node.js 版本为 `v22.23.2`。
- 日志中的运行目录为 `<解压目录>\Amber`，该路径包含空格。
- `.local/runtime-desired.json` 记录期望档位为 `core`。
- `.local/autostart-method.txt` 记录自启动方式为 `startup-folder`。

TODO：补充 Windows 版本、Cursor/Codex 版本、实际执行的安装步骤，以及 `%LOCALAPPDATA%\Amber` 完整目录和用户级 IDE 配置。

## 二、问题清单

### W-MVP-01：Hook 直接使用 `node` 可以执行

- 现象：第二台机器测试确认，Hook 命令直接使用 `node` 可以正常触发记录。
- 原因：MVP 安装器复用了 `nodeExecutable`，将安装时探测到的 Node 绝对路径同时写入 Cursor/Codex Hook 和 MCP；测试机的 Hook 调度环境无法执行该绝对路径。
- 修复：Cursor/Codex Hook 固定生成 `node` 命令；MCP 继续使用安装时探测到的 Node 绝对路径。
- 状态：代码和回归测试已完成，待第二台机器重新安装并完成真实生命周期复测。
- 验收：首次安装后，Cursor 和 Codex 均能完成真实 `begin → complete → sent`，重启后仍可执行。

### W-MVP-02：Cursor AI 修改记录出现乱码

- 现象：截图中来源为 Cursor 的记录，标题和展开后的结果出现明显中文乱码；来源、项目、分支、作者和变更统计仍可显示。
- 证据：用户提供的 AI 修改记录页面截图，记录时间约为 2026-09-02 17:31。
- 原因：Windows 下 Cursor 传给 Hook 进程的标准输入可能已经出现中文乱码；Amber 原有逻辑会在 `stop` 时从 Cursor UTF-8 Hook 日志恢复原文，但 Cursor 同一轮的 `beforeSubmitPrompt` / `afterAgentResponse` 与 `stop` 可能使用不同的 `generation_id`，严格匹配导致恢复失败。
- 修复：按当前 `stop` 在日志中的位置限定查找范围；优先使用相同 `generation_id`，未命中时回退到该位置之前同一会话的最近事件，避免读到后续轮次。
- 验证：定向回归覆盖 generation 不一致和后续轮次隔离；使用已发生乱码的真实历史日志复放，中文需求和中文回答均恢复成功。
- 状态：代码和回归测试已完成，待第二台机器真实 Cursor 任务复测。
- 验收：中文用户需求、结果摘要和文件名在队列、Webhook、飞书记录与 Dashboard 中一致可读。

### W-MVP-03：Cursor 用户需求没有写入记录

- 现象：Cursor 记录中未看到用户原始需求，当前仅能看到乱码的标题或结果内容。
- 原因：与 `W-MVP-02` 共用同一个 `generation_id` 匹配问题；`stop` 无法命中本轮 `beforeSubmitPrompt` 时，只能沿用乱码或空的标准输入字段。
- 修复：与 `W-MVP-02` 合并处理，从当前 `stop` 之前同一会话的最近 `beforeSubmitPrompt` 恢复用户原始需求。
- 状态：代码和回归测试已完成，待第二台机器真实 Cursor 任务复测。
- 验收：Cursor 真实任务产生的记录包含对应用户需求摘要，且不会用结果摘要代替用户需求。

### W-MVP-04：Dashboard 缺少 Git Webhook 配置入口

- 现象：首次配置页面无法找到 Git 提交记录 Webhook 的配置入口。
- 原因：Dashboard 的 Git 提交记录卡片仅实现了扫描目录，保存接口也只写入 `COMMIT_RECORD_SCAN_ROOTS`；Git Webhook 和 Token 只能手动编辑 `.env.local`。
- 修复：Dashboard 增加 Git Webhook、可选 Token、清空选项和脱敏状态展示；统一保存接口持久化三个相关字段。`amber.bat config` 作为配置入口直接打开 Dashboard，继续保留 `amber.bat edit` 供高级用户手动编辑。
- 相关字段：`FEISHU_COMMIT_WEBHOOK_URL`、`FEISHU_COMMIT_WEBHOOK_TOKEN`、`COMMIT_RECORD_SCAN_ROOTS`。
- 状态：代码、持久化回归和页面实测已完成，待第二台机器覆盖安装后验收。
- 验收：Dashboard 可填写、保存、重新加载 Git Webhook 和扫描目录，并能完成一次真实 Git 提交投递。

### W-MVP-05：开机后没有自动启动监听

- 现象：开机后 Amber 监听未正常运行。
- 本地证据：自启动标记为 `startup-folder`；`runtime-desired.json` 为 `running: true`、`profile: core`。
- 日志证据：watcher 和 health monitor 启动后均报 `Cannot find module 'E:\\Transsioner'`，实际脚本路径在第一个空格处被截断。
- 原因：`Start-Process -ArgumentList` 未为 Node 脚本路径保留双引号，含空格路径被拆成多个参数；手动后台启动和开机自启动共用该脚本。
- 修复：watcher 和 health monitor 的脚本参数均显式保留双引号，并增加真实含空格临时目录回归测试。
- 状态：代码和回归测试已完成，待第二台机器登录 Windows 后复测。
- 验收：安装目录和解压目录含空格时，登录 Windows 后 core watcher 与 health monitor 均保持运行。

### W-MVP-06：重启后配置消失，Dashboard 和 `amber.bat` 均无法启动

- 现象：首次安装后填写 Webhook 等配置，当时可用；重启后页面中的配置消失，Dashboard 启动按钮和 `amber.bat` 启动均失败。
- 启动证据：`.local/start-watch.log` 在 2026-09-02 17:46—17:56 之间重复记录多次启动；对应进程随后退出。`.local/watch-all.log` 最终记录“监听服务启动后未进入运行状态”。
- 配置证据：安装器默认运行根目录为 `%LOCALAPPDATA%\Amber`，本次提供的日志来自含版本号的解压目录，存在两个 Runtime 副本。Dashboard 将配置写入自身根目录的 `.env.local`，因此从另一副本启动时会显示未配置。
- 配置修复：解压目录中的 `amber.bat` 检测到用户级 `AMBER_HOME` 后，自动转交给已安装 Runtime；覆盖安装继续保留已有 `.env.local`。
- 启动修复：与 `W-MVP-05` 共用含空格脚本参数修复。
- 状态：配置保存、Dashboard 停止后重启恢复、双根目录转交和含空格启动回归测试均已通过；待第二台机器重启 Windows 验收。
- 验收：保存配置后磁盘立即存在对应值；重启 Dashboard、Amber 和 Windows 后配置仍可加载；启动失败时页面展示可定位错误。

### W-MVP-07：第二台机器 `.local` 文件夹现场

已提供的 `.local` 副本包含：

- `autostart-method.txt`
- `runtime-desired.json`
- `start-watch.log`
- `watch-all.log`、`watch-all-error.log`、`watch-all.pid`
- `health-monitor.log`、`health-monitor-error.log`、`health-monitor.pid`

当前副本未包含 change-record、commit-record 队列和配置文件。该目录可以证明启动尝试和错误，无法单独证明配置是否成功持久化。

### W-MVP-08：第一次重启未自启动，第二次重启才自启动

- 现象：干净安装后第一次重启 Windows，Amber 没有自动启动；第二次重启后 Amber 自动启动成功。
- 影响：开机自启动存在间歇性，首次安装后的运行状态不可靠，用户可能误判安装失败。
- 当前判断：`15:17:03` 已确认为手动重启 Runtime；`15:20:34` 的启动来源仍无法区分。下载目录与安装目录可能造成检查口径混淆，现有证据不足以确认开机自启动失效。
- 状态：暂缓修复，待按安装目录连续重启三次复测。
- 验收：同一测试账号连续重启并登录三次，每次等待 60 秒后 core watcher 与 health monitor 均自动运行。

### W-MVP-09：保存配置后 Runtime 未重启，AI 修改记录停留在待发送

- 现象：用户在 Dashboard 保存 Webhook 等配置后没有重启 Amber；随后产生的 AI 修改记录进入本地队列，但一直显示“待发送”。截图显示全部 `1`、待发送 `1`、已发送 `0`、失败 `0`。
- 补充：AI 链路已由第二台机器日志确认；Git 链路存在相同的启动时配置缓存，真实 Webhook 投递仍待复测。
- 影响：Dashboard 显示配置保存成功，但运行中的记录 worker 仍使用启动时 Webhook，记录会停留在待发送。
- 原因：Dashboard、AI worker、Git worker 是独立进程。Dashboard 保存后只刷新自身环境变量；AI worker 只在启动时读取 `.env.local`；Git worker原先只热加载扫描目录。
- 修复：AI/Git worker 每次投递前读取最新 `.env` 和 `.env.local`；Git 配置变更时立即执行一次扫描与投递。更新或清空 Webhook 均无需重启 Runtime。
- 状态：本地已修复，第二台干净 Windows 机器待复测。
- 验证：运行中的真实 AI/Git worker 保存新 Webhook 后自动发送原有待发送记录；完整测试 `146/146` 通过。
- 验收：先启动 Runtime，再保存 AI/Git Webhook；不重启 Runtime，已有待发送记录和新记录均在下一轮投递中进入已发送。

### W-MVP-10：未创建或打开项目时无法完成 Hook 信任

- 现象：干净 Windows 机器安装 Amber 后，如果尚未创建或打开任何项目，无法完成 Hook 信任。
- 影响：测试步骤将“信任 Hook”放在创建测试项目之前时，新用户会卡在首次接入流程。
- 当前判断：已确认 Hook 信任存在项目上下文前提；具体影响 Cursor、Codex 或两者的范围待补充验证。
- 状态：待确认产品范围、待完善首次接入流程。
- 验收：首次接入步骤明确要求先创建或打开项目，再进入 Hook 管理完成信任；安装完成页或诊断结果能够提示该前提。

## 三、建议处理顺序

1. `W-MVP-09`：优先复现配置保存后的 worker 状态，确认是否需要自动重载配置或重启 Runtime，并处理现有待发送记录。
2. `W-MVP-08`：收集首次和第二次重启日志，连续重启三次验证自启动稳定性。
3. `W-MVP-10`：确认影响的客户端范围，调整首次接入步骤和安装后提示。
4. `W-MVP-01`、`W-MVP-05`、`W-MVP-06`：继续完成 Hook 生命周期、配置持久化和重启验收。
5. `W-MVP-02`、`W-MVP-03`：使用同一条 Cursor 真实任务验收中文需求和结果。
6. `W-MVP-04`：使用 Dashboard 保存 Git Webhook 和扫描目录后执行一次真实提交投递。

## 四、第二台机器复测所需材料

复测现有问题时，需要从测试机补充以下只读材料：

1. `%LOCALAPPDATA%\Amber` 顶层文件列表。
2. `%LOCALAPPDATA%\Amber\.env.local` 是否存在、文件大小和最后修改时间；内容中的 Token/Webhook 必须脱敏。
3. 实际运行的 `install.bat` 所在目录。
4. 启动文件夹中 Amber 快捷方式的目标、参数和工作目录。
5. `%USERPROFILE%\.codex\hooks.json` 与 `%USERPROFILE%\.cursor\hooks.json` 中 Amber 命令；其他配置和凭据需隐藏。
6. 第一次和第二次重启后 `.local\start-watch.log`、`watch-all.log`、`health-monitor.log` 的文件时间和脱敏内容。
7. 保存 Dashboard 配置的时间、产生待发送记录的时间，以及对应队列文件和 worker 进程的时间信息。
8. 创建或打开项目之前、之后的 Hook 管理界面截图，用于确认 `W-MVP-10` 影响范围。
