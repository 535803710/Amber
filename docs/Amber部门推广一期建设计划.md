# Amber 部门推广一期建设计划

## Summary

推广目标：Windows 开发者通过公司 npm 一条命令安装 Amber，创建或连接一个自有飞书 Amber 空间；后续通过自然语言完成查看、诊断、升级和修复。数据始终保存在用户管理的 Base 与本机目录中。

当前阶段：Windows MVP 已完成多机器验证；飞书模板复制、工作流启用、AI/Git 写入和顺序重发去重均已通过 PoC。下一阶段进入 CLI、Skill 与公司 npm 灰度建设。

确定的产品形态：

```text
公司 npm：@amber/cli
        ↓
安装 Runtime + Amber Skill
        ↓
创建/连接用户自有 Base 空间
        ↓
配置 Cursor/Codex Hook 与 MCP
        ↓
注册多个本地项目
        ↓
自动采集 → 用户 Base → MCP 恢复现场
```

一期采用：

- Windows 先行。
- 一个 Amber 空间承载多个项目。
- 公司 npm 内部库，内网免登录读取。
- CLI 与 Runtime 放在同一个 `@amber/cli` 包。
- Apache-2.0。
- 快速入口采用“AI 口令 + Windows 开始菜单”。
- Base 自动复制，两个 Webhook 地址由用户粘贴并自动验证。
- 维护方仅提供模板和软件，无用户数据访问能力。

## Key Changes

### 1. 飞书 Amber 空间

建立一份无业务数据的标准 Base 模板，包含：

- “Amber 使用说明”文档。
- “VibeCoding修改记录”表（产品侧称 AI 修改记录），字段与现有修改事件契约一致。
- “Git提交记录”表，字段与现有提交事件及 MCP 查询契约一致。
- 两个“接收到 Webhook 时”工作流。
- 按项目、工具、作者和时间查看的基础视图。
- 两张表的字段结构指纹，由 CLI 和 `doctor` 检查兼容性，不增加第三张配置表。

空间生命周期：

- `amber space init`：通过用户身份复制 [飞书 Amber 空间模板](https://transsioner.feishu.cn/base/JDHxbOPw9aBWrQskKBRcw911nPI)，识别 Base token 和两张表 ID。
- `amber space connect <Base URL>`：其他成员连接项目组或部门已经创建的空间。
- 自动打开两个工作流页面，用户复制 Webhook 地址并粘贴回 CLI。
- CLI 发送带 `setup-test` 标识的测试事件，确认两个工作流返回 2xx 且记录成功写入。
- 项目开始时执行 `amber project add <path>`；Base 空间只需创建一次。

PoC 已确认：Base 副本能够保留说明文档、两张表和两个工作流；工作流可在副本中启用并取得独立 Webhook；AI 修改和 Git 提交测试事件能够成功写入。相同事件按顺序重发时不会生成重复记录。

一期飞书接入固定为半自动流程：CLI 自动复制模板、识别两张表并启用工作流；随后打开两个工作流页面，由用户复制 Webhook 地址并粘贴回 CLI；CLI 发送测试事件验证 HTTP 响应和实际入表结果。

已知 P1 风险：两个完全相同的事件并发到达时，工作流的“查找后新增”存在竞态并可能生成重复记录。当前 Amber 使用本地单 Worker 顺序投递，该风险不阻塞一期 CLI 建设；原子去重能力进入后续阶段。

### 2. npm 包与统一 CLI

将现有包调整为公司内部 npm 包 `@amber/cli`：

- 增加 `bin/amber.mjs`，注册 `amber` 命令。
- 使用 `files` 白名单，仅发布 CLI、Runtime、Dashboard、Skill、必要模板和用户文档。
- 增加 Apache-2.0 `LICENSE`、正式 README、版本和构建 commit。
- 清除默认 Base token、table ID、公司飞书域名、人员复测文档和内部路径。
- `.env.local` 初始 Base/Webhook 配置保持为空。
- `npm pack --dry-run`、敏感信息扫描、完整测试和包内容检查作为发布门禁。
- 使用 `beta` dist-tag 完成试点，通过后再发布 `latest`。

首次安装命令：

```powershell
npx --yes --registry=https://npm-fe.transsion.com/ @amber/cli@beta install
```

用户无需永久修改 npm 源。发布与安装都指向 `https://npm-fe.transsion.com/`（见 `package.json` 的 `publishConfig`）。`private` 已关闭以便发布到公司源；`bin` 注册 CLI，`files` 控制发布范围。[npm package.json](https://docs.npmjs.com/files/package.json/)

CLI 命令：

| 命令 | 职责 |
| --- | --- |
| `install` | 安装 Runtime、Skill、Hook/MCP、自启动和快捷方式，并进入空间配置 |
| `space init/connect/status` | 创建、连接和检查用户 Base 空间 |
| `project add/remove/list` | 管理当前空间采集的本地项目 |
| `open` | 启动并打开本地 Dashboard |
| `status` | 输出 Runtime、队列、空间和项目状态 |
| `doctor` | 检查 Node、lark-cli、IDE、Base、Webhook、进程和端口 |
| `update` | 从公司 registry 安装指定版本，迁移配置并执行健康检查 |
| `rollback` | 恢复上一可用 Runtime 和 IDE 配置 |
| `uninstall` | 移除 Runtime、Skill、Hook/MCP、自启动和快捷方式，默认保留用户数据 |

所有命令支持 `--json`，统一输出：

```json
{
  "status": "ok | needs_action | failed",
  "code": "稳定错误码",
  "message": "脱敏说明",
  "actions": [],
  "data": {}
}
```

进程退出码固定为：`0=成功`、`1=失败`、`2=需要用户继续操作`。

### 3. Skill 与快速入口

将 Skill 安装到用户级 `~/.agents/skills/amber/`，Cursor 可以发现该目录，当前 Codex 环境也已使用该目录。Cursor 官方同时兼容 `.agents/skills` 和 Codex skill 目录。[Cursor Skills](https://prod.cursor.com/docs/skills)

Skill 包含：

- `SKILL.md`：触发场景、命令选择、安全边界和结果解释。
- `references/onboarding.md`：首次安装、Hook 信任和飞书空间初始化。
- `references/troubleshooting.md`：常见错误与 doctor 恢复步骤。
- 使用 CLI 完成确定性操作，Skill 中仅保留编排与说明。

支持自然语言：

- “帮我接入 Amber”
- “打开 Amber 控制台”
- “检查 Amber 是否正常”
- “把这个项目加入 Amber”
- “更新 Amber”
- “恢复上一个版本”

快速查看方案：

- 安装器创建 Windows 开始菜单“Amber 控制台”快捷方式。
- 快捷方式直接执行 `%LOCALAPPDATA%\Amber\amber.bat open`。
- `open` 检查 Dashboard 状态，按需隐藏启动服务，然后打开浏览器。
- Runtime 继续开机自启动，Dashboard 保持按需启动。
- 一期暂缓系统托盘和桌面客户端。

### 4. 其他必须建设

- **项目身份**：为项目增加稳定 `project_key`，优先采用规范化 Git remote，缺失 remote 时使用明确配置，降低同名仓库混淆。
- **配置迁移**：版本化管理 Base schema、本机配置和 IDE 配置；重复安装保持幂等。
- **更新回滚**：更新前停止 Runtime、备份当前版本、在 staging 校验新版本、切换后执行 doctor，失败自动恢复。
- **lark-cli 依赖**：安装器自动检测、引导安装和登录；公司 npm 发布前确认 registry 可以代理或镜像 `@larksuite/cli`。
- **权限治理**：Base 复制和读取统一使用用户身份；空间创建者自行授权成员。
- **隐私边界**：默认零集中遥测；故障支持由用户主动导出脱敏 `doctor --json`。
- **兼容矩阵**：记录 Windows、Node、Cursor、Codex 和 lark-cli 已验证版本。
- **发布治理**：只有干净 Git tag、测试通过、包内容审计通过的版本才能进入 `beta/latest`。
- **推广材料**：提供一分钟安装说明、Hook 信任图、Base 空间说明、问题反馈模板和回滚 SOP。

### 5. 下一阶段顺序

1. 冻结飞书模板 v1，并固化两张表的字段结构指纹。
2. 将现有 `team-setup` 封装为公司 npm 包 `@amber/cli`。
3. 完成 `install`、`space`、`project`、`open`、`doctor` 和 `uninstall` 命令。
4. 创建 Amber Skill，由自然语言调用确定性的 CLI 能力。
5. 发布公司 npm `beta` 版本并执行发布门禁。
6. 在干净 Windows 机器完成灰度和兼容矩阵验证。
7. 验收通过后将 dist-tag 提升为 `latest`。

公共 npm、macOS、多个空间、系统托盘、Plugin、企业管理后台和并发原子去重进入后续阶段。

## Test Plan

### 自动化验证

- CLI 参数、JSON 输出和退出码。
- 全新安装、重复安装、保留配置和卸载。
- Skill 安装、更新和移除。
- Cursor/Codex Hook、MCP 结构化合并与恢复。
- Base URL 解析、表识别、Webhook 校验和错误恢复。
- Base 模板字段结构指纹校验，字段缺失或类型变化时返回可诊断错误。
- 多项目注册、去重、移除和 `project_key`。
- Dashboard 开始菜单入口与按需启动。
- 更新成功、健康检查失败自动回滚。
- `npm pack --dry-run` 内容白名单和敏感信息扫描。

### Windows 端到端验证

1. 干净机器执行一条公司 npm 命令。
2. lark-cli 缺失、未登录和已登录三种环境分别验证。
3. 创建新空间并连接已有空间。
4. 配置两个 Webhook，完成 AI/Git 测试记录。
5. 顺序重复发送相同事件，确认两张表均不新增重复记录。
6. Cursor 和 Codex 各完成一次真实修改。
7. 两个本地项目进入同一 Base，并可通过 MCP 分别恢复历史。
8. 从 AI 口令和开始菜单打开 Dashboard。
9. 连续重启三次验证自启动。
10. 从 `beta N` 更新至 `beta N+1`，随后执行一次 rollback。
11. 卸载后确认用户 Base、`.local` 数据和其他 IDE 配置保持完整。

### 推广验收

- 首批 10～20 名 Cursor/Codex 混合用户连续使用一周。
- 一条命令完成安装，原 IDE 配置保持完整。
- AI/Git 记录稳定写入各自管理的 Base。
- 每位用户至少完成一次 MCP 历史现场恢复。
- 批量安装失败和配置破坏均为零。
- 常见问题可以通过 `doctor` 和固定 SOP 定位。
- 试点通过后将 dist-tag 从 `beta` 提升为 `latest`。

## Assumptions

- 一期仅支持 Windows、一个 Amber 空间和多个本地项目。
- 公司 npm registry 为 `https://npm-fe.transsion.com/`，内网读取；`publishConfig.registry` 已写入 `package.json`。
- 包名固定为 `@amber/cli`。
- 公司 registry 需要能够代理或镜像 lark-cli；该能力属于发布门禁。
- 飞书模板由 Amber 项目维护，模板保持空数据状态。
- 用户自行管理 Base 权限，Amber 维护方不接触用户记录。
- 一期采用自动复制与手动粘贴两个 Webhook 地址。
- 并发相同事件去重不作为一期发布门禁，相关风险需要保留在兼容说明中。
- 公共 npm、macOS、多个空间、系统托盘、Plugin、企业管理后台和并发原子去重进入后续阶段。
