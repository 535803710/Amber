# vibecoding 时摸鱼防沉迷提醒⏰


![手环效果图](https://pub-a953275fa2c34c18b80fc1f84e3ea746.r2.dev/xiaowo/2026/06/18e81951287250e7e78d205dbead07c6.jpg)
## 等 Agent 的时候总在摸鱼错过“签字”，于是想办法把通知推到了手环

每次 vibecoding 等待的时候，我总是去摸鱼🐟 刷刷擦边什么的。

但一刷手机就忘了看电脑屏幕关注通知。

每次刷得太入迷，忘记了自己还是个「李鸿章」，洋大人的「条约」还等着我签( Codex 和 Cursor 还在那儿等我点确认。)

等我想起来回去看，Agent 已经停在那儿好久了。

所以搞了个小东西：把通知推到手环上。

## 它是什么（原理

一个跑在本地的小工具。Agent 跑完，或者卡着等你操作时，飞书推一条消息，手环跟着震一下。

我本着最懒的实现：（做多了也没什么必要，比如那个 vibe红绿灯。。。）

1. 监听 Windows 系统通知 toast（纯 vibecoding 实现就行了）
2. 发一条飞书消息（webhook + 机器人 + 最简单方法建一个群）
3. 手环开飞书通知（自定义一个震动模式，和普通消息区分开）


## 怎么用

### 第一次配

1. 飞书建群聊，加一个自定义机器人，复制 webhook。

![飞书群聊，机器人页面](https://pub-a953275fa2c34c18b80fc1f84e3ea746.r2.dev/xiaowo/2026/06/e346757c3691107435dd4c6f4b33c84a.png)

2. 填配置：打开 `mi-notic.bat` → 按 1 打开 web 配置页面 → 填入 webhook，保存。

   或者直接改配置文件：(网页上配置比较方便)

```powershell
copy .env.example .env.local
# 填 FEISHU_WEBHOOK_URL
```

3. Windows 开「用户通知访问」，放行 PowerShell（`设置 -> 隐私和安全性 -> 通知 -> 用户通知访问`）。后台监听是 PowerShell 起的，这一步不开就读不到 toast。

### 用网页控制台（推荐）

**最省事的方式**。双击 `mi-notic.bat`，弹出菜单选 1：

![bat终端页面](https://pub-a953275fa2c34c18b80fc1f84e3ea746.r2.dev/xiaowo/2026/06/09a0ddbf3fd8bc3f5aa40a6845d37156.png)

或者跑 `npm run dashboard`，浏览器开 http://127.0.0.1:3847 。开关监听、勾选哪些场景发飞书、看最近一条状态，都在这一页。先点「测试通知」，手环震了就说明链路通了。

![web页面](https://pub-a953275fa2c34c18b80fc1f84e3ea746.r2.dev/xiaowo/2026/06/6b07a23b4e502d4973170411c3056e6a.png)

### 命令行

习惯终端的话，两条就够日常用：

```powershell
npm run notify:test   # 测链路
npm run watch:all     # 开监听
```

不想每次手动开，装一次开机自启：

```powershell
npm run autostart:install
```

Cursor 里也能开：命令面板 `Tasks: Run Task` → `mi-notic: watch all (toast + UI prompts)`。

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

### Git 提交记录

`watch:all` 会只读扫描 `D:\project` 下的 Git 本地分支；不修改项目源码、Git 配置或现有 Hook。首次启动只建立基线，之后的新 commit 会写入独立队列并投递到 `FEISHU_COMMIT_WEBHOOK_URL`。可用 `npm run commits:status`、`npm run commits:dry-run`、`npm run commits:replay` 查看和处理本地队列。

## 最后

跑起来之后是这样的：

Agent 干完活，手环震，我回去看看结果；

Agent 等我确认，手环震，我回去签「条约」。

提醒这一环，确实补上了。


但是。。。

提醒补上了，注意力没补上。好几次手环震了，我这边还在刷，白震了。。。😂

## GIT地址：
项目地址：[https://github.com/535803710/mi-notic](https://github.com/535803710/mi-notic)
