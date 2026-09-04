---
name: amber
description: >
  接入、检查、更新和回滚 Amber Windows Runtime。当用户说「帮我接入 Amber」「打开 Amber 控制台」「检查 Amber 是否正常」「把这个项目加入 Amber」「更新 Amber」「恢复上一个版本」时使用。确定性操作一律通过 Amber CLI 完成；本 Skill 只编排命令并解释结果，不自己改 IDE JSON。
---

# Amber

Windows 上的 Amber Runtime：采集 AI 修改与 Git 提交，投递到用户自己的飞书 Base，并用 MCP 恢复研发现场。

## 触发

用户出现以下意图时使用本 Skill：

- 帮我接入 Amber
- 打开 Amber 控制台
- 检查 Amber 是否正常
- 把这个项目加入 Amber
- 更新 Amber
- 恢复上一个版本

首次安装、Hook 信任、空间初始化和粘贴 Webhook 见 [onboarding.md](references/onboarding.md)。常见错误码见 [troubleshooting.md](references/troubleshooting.md)。

## 调用 CLI

确定性操作全部通过 CLI，不要手改配置文件。按顺序选用：

1. `node bin/amber.mjs <command>`（当前仓库或已定位的安装源）
2. `%AMBER_HOME%\amber.bat <command>`（已安装 Runtime）
3. `npx --yes --registry=https://npm-fe.transsion.com/ @amber/cli@beta <command>`（尚未安装或需要指定版本）

编排时加 `--json`，根据返回的 `status` / `code` / `actions` 决定下一步。

## 命令

| 用户意图 | 命令 |
| --- | --- |
| 安装 Runtime、Skill、Hook/MCP | `install` |
| 创建飞书 Amber 空间 | `space init` |
| 连接已有空间 | `space connect` |
| 查看空间状态 | `space status` |
| 把当前或指定项目加入采集 | `project add` |
| 停止采集某项目 | `project remove` |
| 列出已登记项目 | `project list` |
| 打开 Amber 控制台 | `open` |
| 查看 Runtime / 队列 / 空间状态 | `status` |
| 诊断依赖、Hook、Base、Webhook、进程 | `doctor` |
| 更新到指定或最新 beta | `update` |
| 恢复上一个版本 | `rollback` |
| 卸载（默认保留用户数据） | `uninstall` |

子命令写法：`space init|connect|status`，`project add|remove|list`。

## 安全边界

- 不把 webhook、token、Bearer、`.env.local` 内容读进对话；需要排障时只转述 CLI 已脱敏的 `message` 和 `actions`。
- 不扩大采集范围：只对用户确认过的项目执行 `project add`，不扫描未授权目录。
- 不访问用户 Base 以外的数据；没有用户空间配置时不要去查维护者或其他团队的表。
- Skill 只编排 CLI，不自己改 IDE JSON（Cursor/Codex 的 Hook、MCP、settings 由 `install` / `update` / `rollback` 写入）。

## 结果解释

把 CLI JSON 翻译成用户下一步，不要只回传原始 JSON。

| `status` | 含义 | 对用户怎么说 |
| --- | --- | --- |
| `ok` | 完成 | 简述 `message`；若 `actions` 非空，列为建议跟进 |
| `needs_action` | 需要用户继续操作（退出码 2） | 逐条执行 `actions`，例如信任 Hook、粘贴 Webhook、确认路径 |
| `failed` | 失败（退出码 1） | 说明 `code` 与 `message`，按 [troubleshooting.md](references/troubleshooting.md) 跑 `doctor` |

`code` 是稳定错误码，用它匹配排障步骤，不要根据英文句子猜测。
