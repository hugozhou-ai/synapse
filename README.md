# Synapse

Synapse 是一个 macOS 优先的 Electron 全局挂件：通过 Codex lifecycle Hooks 感知并持久化正在进行和刚结束的本地任务，再调用本地 Codex App Server，把选定 turns 整理成可编辑、可追溯的总结。

主要能力：

- 透明、置顶、跨 Space 的全局挂件与 Tray。
- `SessionStart` / `UserPromptSubmit` / `Stop` Hook 感知，完整 prompt/assistant 内容本地落库，Unix socket 在线传输与 `0600` 离线 spool。
- 任意 turn 多选、Shift 连选、350ms 长按拖选。
- 本地 Codex App Server 总结 harness，固定 JSON Schema，长会话按 turn 分块。
- SQLite WAL 主存储、不可变版本历史、FTS5 搜索与 Markdown/JSON 导出。
- Apple Notes 可选同步；同一总结持续更新同一便签。

实现依据：[Codex Hooks](https://learn.chatgpt.com/codex/hooks) 与 [Codex App Server](https://learn.chatgpt.com/codex/app-server)。App Server 使用稳定的 `stdio` JSONL transport。

## 开发

要求：macOS、Node.js 22.13+、本地可用的 Codex 或 ChatGPT Desktop 内置 Codex binary。

```bash
npm install
npm run dev
```

质量检查：

```bash
npm run check
npm run build
```

生成 macOS 安装包：

```bash
npm run package:mac
```

SQLite 使用 Node 与 Electron 均内置的 `node:sqlite`，开发、测试和打包不需要切换原生模块 ABI。

正式分发需要在 Electron Builder 环境中配置 Developer ID 签名与公证凭据。`build/entitlements.mac.plist` 已包含 Apple Events entitlement。

## 首次使用

1. 首次启动且尚未处理过 Hook 设置时，Synapse 会自动打开设置引导；也可从挂件齿轮或 Tray 进入“设置 → Codex Hook”。点击“安装 Hook”后，Synapse 会备份并原子合并 `~/.codex/hooks.json`，并在 `[features]` 中启用规范的 `hooks = true`。
2. 在 Codex 中输入 `/hooks`，检查来源并信任 `Managed by Synapse` 的三个 Hook。Synapse 不会绕过 Codex 的信任机制。
3. 重启或恢复一个 Codex 任务。提交 prompt 后挂件应立即显示进行中，Stop 后卡片置顶并出现“总结”。
4. 如需 Apple Notes，在设置中从已发现的账户/文件夹中选择目标（也可新建文件夹），并在 macOS 首次权限提示中允许 Synapse 控制“便签”。

卸载 Hook 只会删除 manifest 标记的 Synapse handler；用户原有配置保持不变。

## 本地数据

- 数据库：`~/Library/Application Support/Synapse/synapse.sqlite3`
- Hook relay：`~/Library/Application Support/Synapse/bin/codex-hook-relay.sh`
- Unix socket：`~/Library/Application Support/Synapse/run/hook.sock`
- 运行日志：`~/Library/Application Support/Synapse/logs/synapse.log`
- 离线事件：`~/Library/Application Support/Synapse/spool/`
- Hook manifest 与备份：`~/Library/Application Support/Synapse/`

SQLite 保存 Hook 提供的完整 prompt/assistant 内容、事件最小元数据和总结版本，供后台整理直接使用；数据不会发送到 Synapse 自有服务。日志不会记录 prompt、会话正文或总结正文，动态字段统一经 `JSON.stringify` 输出。

## 架构

依赖方向固定为：

```text
Renderer / Preload / IPC
          ↓
Application Services
          ↓
Domain Aggregates / Domain Services
          ↓
Ports ← Infrastructure Adapters
```

详细类与接口映射见 [docs/architecture.md](docs/architecture.md)，人工联调步骤见 [docs/manual-verification.md](docs/manual-verification.md)。

自动化测试使用 Fake App Server、临时 SQLite 和临时 Codex 配置目录，不修改真实 `~/.codex`，也不消耗 Codex 额度。
