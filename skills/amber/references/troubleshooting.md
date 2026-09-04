# Amber 常见错误与 doctor 恢复

先跑诊断，再按 `code` 处理。不要读取 webhook / token，不要手改 IDE JSON。

```powershell
node bin/amber.mjs doctor --json
```

已安装时也可用 `%AMBER_HOME%\amber.bat doctor --json`。把 JSON 里的 `status`、`code`、`message`、`actions` 翻译给用户；完整凭据留在本机。

## windows_only

Amber 一期只支持 Windows。

1. 确认当前是 Windows，且用 PowerShell / `amber.bat` 调用。
2. 在非 Windows 上不要继续 `install`；告知用户当前平台不在支持范围。
3. 仍要核对本机环境时执行 `doctor --json`，确认 `code` 仍为 `windows_only`。

## template_token_missing

飞书空间模板不可用，`space init` 无法复制 Base。

1. 执行 `doctor --json`，看 `actions` 是否指向模板或 lark-cli 登录。
2. 请用户完成 `lark-cli` 用户登录（不要在对话中粘贴 token）。
3. 登录后再执行 `space init --json`。
4. 若仍失败，用 `space status --json` 确认尚未连上空间，然后按 `actions` 重试，不要手填维护者 Base。

## webhook_setup_required

两个「接收到 Webhook 时」工作流还没有有效地址，或测试事件未入表。

1. 执行 `space status --json` 和 `doctor --json`。
2. 请用户打开 CLI 给出的两个工作流页面，复制 Webhook 并只粘贴回 CLI。
3. 等待 CLI 发送 `setup-test` 并确认两条都成功。
4. 不要把 Webhook 发到聊天；不要扩大采集范围来“绕过”投递失败。

## schema_mismatch

用户 Base 的表结构与当前 Amber 模板不一致。

1. 执行 `doctor --json`，记录 `code=schema_mismatch` 和 `actions`。
2. 不要手工改多维表格字段凑合使用。
3. 按 `actions` 提示用 `space init` / `space connect` 对齐模板，或 `update` 后再 `doctor`。
4. 修复前不要对业务表做破坏性迁移；用户数据仍只留在用户自己的 Base。

## project_key_required

当前目录还不能稳定标识为 Amber 项目（缺少规范化 Git remote 或明确配置）。

1. 执行 `project list --json` 和 `doctor --json`。
2. 在 Git 仓库根目录执行 `project add`；仓库外必须传绝对路径。
3. 确认该路径是用户要采集的项目，不要把额外磁盘路径加进去。
4. 按 `actions` 补 remote 或项目标识后重试 `project add --json`。

## dashboard_unhealthy

本地控制台未就绪或健康检查不通过。

1. 执行 `status --json` 与 `doctor --json`。
2. 按 `actions` 启动 Runtime 后执行 `open`。
3. 若端口占用或进程异常，只使用 CLI 给出的恢复命令，不要手改系统服务配置。
4. 控制台能打开后，再看队列和健康页确认采集恢复。

## update_health_failed

更新已切到新版本，但后续健康检查失败。

1. 不要继续对半更新的环境做手工修补。
2. 执行 `doctor --json`，确认 `code=update_health_failed`。
3. 立即执行 `rollback --json`，恢复上一可用 Runtime 和 IDE 配置。
4. 回滚后再 `doctor --json`；仍失败则按本页其他 `code` 继续，而不是再跑一遍 `update`。
