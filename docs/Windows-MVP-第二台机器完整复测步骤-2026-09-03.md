# Amber Windows MVP 第二台机器完整复测步骤

测试日期：2026-09-03

测试目标：验证 `W-MVP-01`～`W-MVP-06` 的修复在另一台 Windows 机器上真实生效。

适用范围：维护者使用新构建的 Windows ZIP 做覆盖升级或干净安装验证。该 ZIP 当前不作为部门推广入口。

## 一、测试前提

1. Windows 10 或 Windows 11，使用普通用户账号测试。
2. Node.js 22 或更高版本可用：

   ```powershell
   node --version
   ```

3. 已安装 Cursor 和 Codex，至少各自可以新建一次 AI 任务。
4. `lark-cli` 已登录，测试账号拥有 Amber Base 和 AI/Git 两张表的读取权限。
5. 准备测试专用的 AI 修改记录 Webhook、Git 提交记录 Webhook，以及可选 Token。
6. 本机端口 `3847` 未被其他程序占用。
7. 使用修复完成后重新构建的 ZIP。记录包名、生成时间和 manifest 中的 SHA-256，禁止继续使用 2026-09-02 16:43 生成的旧 `Amber-team-v1.4.0-mvp.1.zip`。
8. 解压目录建议包含空格，例如：

   ```text
   %USERPROFILE%\Downloads\Amber MVP Test\
   ```

   该目录用于覆盖含空格路径的启动回归。

## 二、测试信息记录

开始测试前填写：

| 项目 | 实际值 |
| --- | --- |
| Windows 版本 | |
| Windows 用户名 | 仅记录脱敏名称 |
| Node.js 版本 | |
| Cursor 版本 | |
| Codex 版本 | |
| 安装包名称 | |
| 安装包 SHA-256 | |
| 解压目录 | |
| 安装目录 | 预期为 `%LOCALAPPDATA%\Amber` |
| 测试开始时间 | |

## 三、安装前现场保留

第二台机器已经安装过 Amber 时，先执行以下只读检查。不要删除原 `.env.local` 和 `.local`。

```powershell
[Environment]::GetEnvironmentVariable("AMBER_HOME", "User")
Test-Path "$env:LOCALAPPDATA\Amber\.env.local"
Get-Item "$env:LOCALAPPDATA\Amber\.env.local" -ErrorAction SilentlyContinue |
  Select-Object FullName, Length, LastWriteTime
Get-ChildItem "$env:LOCALAPPDATA\Amber\.local" -File -ErrorAction SilentlyContinue |
  Select-Object Name, Length, LastWriteTime
```

保存输出截图。只记录 `.env.local` 是否存在、大小和修改时间，不展示文件内容。

## 四、覆盖安装

1. 将新 ZIP 解压到包含空格的测试目录。
2. 双击或在 PowerShell 中运行：

   ```powershell
   .\install.bat
   ```

3. 安装完成后确认：

   - 安装目录为 `%LOCALAPPDATA%\Amber`；
   - 用户级 `AMBER_HOME` 指向该安装目录；
   - 安装过程没有出现 `Cannot find module`、路径截断或权限错误；
   - 原有 `.env.local` 和 `.local` 仍然存在。

4. 进入安装目录执行诊断：

   ```powershell
   cd "$env:LOCALAPPDATA\Amber"
   .\amber.bat doctor --json
   ```

5. 验收诊断中的运行文件、Cursor/Codex Hook、Cursor/Codex MCP、`lark-cli` 和 Base 权限。可选 Webhook 尚未配置时允许显示警告。

## 五、Hook 配置与信任

1. 打开以下配置，确认 Amber Hook 命令以 `node` 开头，后面跟带双引号的脚本路径：

   ```text
   %USERPROFILE%\.cursor\hooks.json
   %USERPROFILE%\.codex\hooks.json
   ```

2. MCP 可以继续使用安装器探测到的 Node 绝对路径，该项无需改成 `node`。
3. 在 Cursor 和 Codex 的 Hook 管理界面重新信任当前 Amber Hook。
4. Reload Cursor，完全退出并重新打开 Codex。
5. 信任完成后再创建全新任务，旧任务不作为本轮验收依据。

验收标准：Hook 命令没有写死不可执行的 Node 路径，Cursor/Codex 均可触发 Amber 脚本。

## 六、Dashboard 与配置保存

1. 在安装目录执行：

   ```powershell
   .\amber.bat config
   ```

2. 确认浏览器打开 `http://127.0.0.1:3847/`。
3. 在“修改记录”卡片填写并保存：

   - `FEISHU_CHANGE_WEBHOOK_URL`
   - `FEISHU_CHANGE_WEBHOOK_TOKEN`（可选）

4. 在“Git 提交记录”卡片填写并保存：

   - `FEISHU_COMMIT_WEBHOOK_URL`
   - `FEISHU_COMMIT_WEBHOOK_TOKEN`（可选）
   - 扫描目录

5. 保存后刷新页面，确认 Webhook 只显示脱敏值，Token 只显示“已配置/未配置”。
6. 检查安装目录中的配置文件元数据：

   ```powershell
   Get-Item "$env:LOCALAPPDATA\Amber\.env.local" |
     Select-Object FullName, Length, LastWriteTime
   ```

验收标准：Git Webhook 有可用配置入口；刷新 Dashboard 后配置状态仍存在；页面不展示完整 Webhook 或 Token。

## 七、Cursor 中文记录测试

1. 在测试仓库创建一个 Markdown 文件，例如 `amber-cursor-test.md`。
2. 在 Cursor 新建任务并输入以下需求：

   ```text
   请在 amber-cursor-test.md 中新增一行：琥珀计划第二台机器中文记录测试成功。
   ```

3. 等待 Cursor 完成修改，再打开 Dashboard 的“AI 修改记录”。
4. 同时检查飞书 AI 修改记录表中的对应记录。

验收标准：

- 用户需求包含本轮中文原文或正确摘要；
- 结果摘要和文件名中文可读，没有乱码；
- 用户需求与结果没有互相替代；
- 记录来源、项目、分支和变更统计正确；
- 对应事件最终进入已发送状态。

该步骤同时验收 `W-MVP-02` 和 `W-MVP-03`。

## 八、Codex Hook 生命周期测试

1. 确认 Codex Hook 已信任，然后创建全新任务。
2. 输入以下需求：

   ```text
   请在 amber-codex-test.md 中新增一行：Codex Hook 生命周期测试成功。
   ```

3. 等待任务完成，检查安装目录：

   ```text
   .local\change-records\hook-health.ndjson
   .local\change-records\queue\sent\
   .local\change-records\hook-errors.log
   ```

验收标准：

- `hook-health.ndjson` 依次出现 ChatGPT `begin`、`complete`；
- 对应队列记录进入 `sent`；
- Webhook 返回 2xx，飞书 AI 修改记录表出现记录；
- `hook-errors.log` 没有 Node 启动、路径截断或 `.git/objects` 权限错误。

该步骤验收 `W-MVP-01` 的 Codex 链路。

## 九、Git 提交投递测试

1. 创建一个含空格和中文名称的临时仓库：

   ```powershell
   $testRoot = Join-Path $env:USERPROFILE "Amber MVP Test"
   $testRepo = Join-Path $testRoot "中文仓库"
   New-Item -ItemType Directory -Force -Path $testRepo | Out-Null
   Set-Location $testRepo
   git init
   git config user.name "Amber Tester"
   git config user.email "amber-test@example.invalid"
   "初始化" | Set-Content -Encoding UTF8 test.md
   git add test.md
   git commit -m "test: amber git webhook"
   ```

2. 将 `$testRoot` 的实际绝对路径填入 Dashboard 的 Git 扫描目录并保存。
3. 若首次提交仅建立扫描基线，再修改并提交一次：

   ```powershell
   "第二次提交" | Add-Content -Encoding UTF8 test.md
   git add test.md
   git commit -m "test: amber second commit"
   ```

4. 等待扫描和投递，检查 Dashboard 与飞书 Git 提交记录表。

验收标准：

- Dashboard 显示正确仓库数；
- 失败数为 `0`；
- 飞书记录包含仓库、分支、提交说明、作者和文件变更；
- 中文仓库名、文件名和提交说明可读；
- Git Webhook 完成真实投递。

该步骤验收 `W-MVP-04`。

## 十、配置持久化与双目录转交测试

1. 配置完成后记录 `.env.local` 的大小和修改时间。
2. 从最初的 ZIP 解压目录执行：

   ```powershell
   .\amber.bat status
   .\amber.bat config
   ```

3. 确认命令转交到 `%LOCALAPPDATA%\Amber`，Dashboard 仍展示刚才保存的配置状态。
4. 在安装目录执行：

   ```powershell
   .\amber.bat stop
   .\amber.bat start
   .\amber.bat status
   ```

5. 再次打开 Dashboard，确认配置状态保持不变。

验收标准：从解压目录和安装目录启动时均使用同一个已安装 Runtime；停止、启动和重新打开 Dashboard 后配置仍存在。

## 十一、Windows 重启与开机自启动测试

1. 重启前执行并保存输出：

   ```powershell
   cd "$env:LOCALAPPDATA\Amber"
   .\amber.bat status
   .\amber.bat doctor --json
   ```

2. 重启 Windows 并重新登录同一个用户账号。
3. 登录后等待 60 秒，再执行：

   ```powershell
   cd "$env:LOCALAPPDATA\Amber"
   .\amber.bat status
   .\amber.bat doctor --json
   ```

4. 打开 Dashboard，确认 AI/Git Webhook、Token 状态和扫描目录仍然存在。
5. 再执行一次 Cursor 中文修改和一次 Git 提交，确认重启后的真实采集与投递仍正常。
6. 检查以下日志中没有路径截断错误：

   ```text
   .local\start-watch.log
   .local\watch-all.log
   .local\watch-all-error.log
   .local\health-monitor.log
   .local\health-monitor-error.log
   ```

验收标准：core watcher 和 health monitor 自动运行；配置没有丢失；日志中没有 `Cannot find module '<路径第一段>'`；重启后的 AI 与 Git 记录均可发送。

该步骤同时验收 `W-MVP-01`、`W-MVP-05` 和 `W-MVP-06`。

## 十二、结果记录

| 问题 | 测试结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| W-MVP-01 Hook 使用 `node` | 待测试 | Hook 配置、生命周期日志、飞书记录 | |
| W-MVP-02 Cursor 中文乱码 | 待测试 | Dashboard 与飞书截图 | |
| W-MVP-03 Cursor 用户需求 | 待测试 | 用户需求字段截图 | |
| W-MVP-04 Git Webhook 入口 | 待测试 | 配置页、Git 记录 | |
| W-MVP-05 开机自动监听 | 待测试 | 重启后 status、日志 | |
| W-MVP-06 配置持久化与启动 | 待测试 | `.env.local` 元数据、重启前后截图 | |

最终结论只使用以下状态：

- **通过**：所有验收项完成，重启后仍能产生新的 AI/Git 记录。
- **部分通过**：存在明确失败项，但其他链路已提供完整证据。
- **阻塞**：缺少安装包、权限、Webhook、Base 访问或测试环境，无法完成真实投递。

## 十三、提交证据时的脱敏要求

- Webhook 仅保留域名和首尾少量字符；
- Token、Cookie、Authorization、飞书凭据全部遮盖；
- 个人邮箱和真实用户名使用占位符；
- `hooks.json`、`config.toml` 仅截取 Amber 相关片段；
- `.env.local` 只提交文件是否存在、大小和修改时间；
- 优先提交 `doctor --json` 的脱敏结果、Dashboard 截图和相关 `.local` 日志。
