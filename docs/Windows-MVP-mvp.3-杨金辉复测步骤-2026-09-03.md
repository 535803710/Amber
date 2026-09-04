# Amber Windows MVP 1.4.0-mvp.3 杨金辉复测步骤

测试目标：在杨金辉的 Windows 电脑上验证 `mvp.3` 覆盖安装、配置热加载、AI/Git 记录投递和开机自启动。

## 一、测试前准备

1. 准备安装包 `Amber-team-v1.4.0-mvp.3.zip` 和同名 manifest 文件。
2. 确认 Node.js 22 或更高版本：

   ```powershell
   node --version
   ```

3. 记录 manifest 中的 `version`、`commit`、`dirty` 和 `sha256`。
4. 保留原配置和队列，只检查文件是否存在，不展示文件内容：

   ```powershell
   Test-Path "$env:LOCALAPPDATA\Amber\.env.local"
   Test-Path "$env:LOCALAPPDATA\Amber\.local"
   ```

5. 在 Cursor 和 Codex 中先打开一个测试项目。Hook 信任界面依赖项目上下文。

## 二、覆盖安装

1. 将 ZIP 解压到新目录，不要直接在压缩包内运行。
2. 在解压目录运行：

   ```powershell
   .\install.bat
   ```

3. 安装完成后进入实际安装目录：

   ```powershell
   cd "$env:LOCALAPPDATA\Amber"
   .\amber.bat doctor --json
   .\amber.bat status
   ```

4. 确认安装版本为 `1.4.0-mvp.3`，原 `.env.local` 和 `.local` 仍存在。
5. 在 Cursor 和 Codex 的 Hook 管理界面信任当前 Amber Hook；重新加载 Cursor，完全退出后重新打开 Codex。
6. 检查 Amber Hook 命令以 `node` 开头，脚本绝对路径带双引号。

## 三、配置热加载测试（W-MVP-09）

1. 先启动 Runtime：

   ```powershell
   .\amber.bat start
   .\amber.bat status
   ```

2. 打开配置页：

   ```powershell
   .\amber.bat config
   ```

3. 保存 AI 修改记录 Webhook、Git 提交记录 Webhook 和 Git 扫描目录。
4. 保存后不要停止或重新启动 Amber。
5. 在 Cursor 新建任务，要求修改一个 Markdown 文件；随后在测试 Git 仓库完成一次新提交。
6. 等待一个扫描周期，查看 Dashboard 和飞书记录。

通过标准：

- AI 和 Git 记录均进入“已发送”；
- 待发送记录自动补发；
- 保存配置后全程没有手动重启 Amber；
- Dashboard 刷新后仍显示 Webhook 已配置和原扫描目录。

## 四、Cursor、Codex 和 Git 链路测试

### Cursor

在新任务中输入：

```text
请在 amber-cursor-mvp3.md 中新增一行：杨金辉电脑 Cursor 中文记录测试成功。
```

确认用户需求、结果摘要和中文文件名无乱码，并在飞书看到对应 AI 修改记录。

### Codex

在全新任务中输入：

```text
请在 amber-codex-mvp3.md 中新增一行：杨金辉电脑 Codex 生命周期测试成功。
```

确认飞书出现对应 AI 修改记录，并检查 `.local\change-records\hook-health.ndjson` 出现 ChatGPT `begin`、`complete`。

### Git

在 Dashboard 配置的扫描目录内修改文件并提交：

```powershell
git add .
git commit -m "test: amber mvp3 delivery"
```

确认 Dashboard 的 Git 仓库数正确、失败数为 `0`，飞书出现本次提交记录。

## 五、连续三次重启测试（W-MVP-08）

连续执行三轮完整的 Windows“重启”，每次登录同一账号后等待 60 秒，再运行：

```powershell
cd "$env:LOCALAPPDATA\Amber"
.\amber.bat status
.\amber.bat doctor --json
```

每轮都确认：

- watcher 和 health monitor 已运行；
- Dashboard 可以打开；
- Webhook 和扫描目录配置仍存在；
- 新建一条 AI 修改记录后能够发送。

若某轮未自动启动，先保留现场并收集以下文件，随后再手动启动：

```text
.local\start-watch.log
.local\watch-all.log
.local\watch-all-error.log
.local\health-monitor.log
.local\health-monitor-error.log
```

## 六、结果记录

| 测试项 | 结果 | 证据 |
| --- | --- | --- |
| 覆盖安装与配置保留 | 待测试 | 安装版本、文件存在性、doctor 输出 |
| 保存配置后 AI 自动发送 | 待测试 | Dashboard、飞书记录、时间截图 |
| 保存配置后 Git 自动发送 | 待测试 | Dashboard、飞书提交记录 |
| Cursor 中文与用户需求 | 待测试 | AI 修改记录截图 |
| Codex 生命周期 | 待测试 | 飞书记录、hook-health.ndjson |
| 第一次 Windows 重启 | 待测试 | status、doctor、日志 |
| 第二次 Windows 重启 | 待测试 | status、doctor、日志 |
| 第三次 Windows 重启 | 待测试 | status、doctor、日志 |

最终结论：全部通过后，`mvp.3` 才可作为本轮 MVP 验收候选包。

## 七、证据脱敏

- Webhook 仅保留域名和少量首尾字符；
- Token、Cookie、Authorization 全部遮盖；
- `.env.local` 只记录是否存在、大小和修改时间；
- 个人邮箱、用户名和仓库地址脱敏。
