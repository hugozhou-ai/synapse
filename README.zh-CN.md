<p align="center">
  <a href="https://github.com/hugozhou-ai/synapse">
    <img alt="Synapse logo" src="build/icon-master.png" width="144" />
  </a>
</p>

# Synapse

[![English Docs](https://img.shields.io/badge/English-Docs-blue)](README.md)

Synapse 是一个面向 macOS 的本地优先 Codex 任务挂件与总结工作台。它通过 Codex lifecycle Hooks 感知正在进行和刚结束的本地任务，再调用本地 Codex App Server，将选定 turns 整理为可编辑、可检索、可追溯的总结。

Synapse 目前仅支持 macOS，依赖本地可用的 Codex binary。它不会把任务内容发送到 Synapse 自有服务；总结生成遵循用户现有的 Codex 配置与数据处理方式。

> **项目状态：** Synapse 仍处于早期开发阶段。仓库暂未提供正式签名和公证的安装包，可从源码运行或在本地构建。

## 工作流

```text
Codex lifecycle Hooks
          ↓
Unix socket / 离线 spool
          ↓
SQLite 本地存储
          ↓
Codex App Server 生成结构化草稿
          ↓
编辑并确认 final → 历史 / Markdown / JSON / Apple Notes
```

1. Synapse 在全局挂件中展示进行中和待整理的 Codex 任务。
2. 任务结束后，可按 turn 任意选择总结所需的事实来源。
3. Codex App Server 生成结构化草稿；标题、摘要、标签和 Markdown 正文均可编辑和预览。
4. 确认后的 final 保留不可变版本历史，并可导出或同步到 Apple Notes。

## 功能

- **全局任务挂件**：透明、置顶、跨 Space 显示，支持 Tray 操作与多显示器位置恢复。
- **可靠的 Hook 感知**：监听 `SessionStart`、`UserPromptSubmit` 和 `Stop`；Unix socket 不可用时写入权限为 `0600` 的离线 spool，恢复后自动重放。
- **精确的 turn 选择**：支持任意多选、Shift 连选，以及约 350ms 长按后的拖动选择。
- **结构化总结**：使用固定 JSON Schema 生成标题、摘要、正文和标签；长会话按 turn 边界分块，不静默截断来源。
- **可追溯历史**：SQLite WAL 持久化、不可变版本记录、FTS5 全文搜索，以及 Markdown / JSON 导出。
- **Apple Notes 同步**：可选择账户与文件夹；同一份总结持续更新同一条便签，失败后由用户手动重试。
- **最小权限运行**：总结 agent 使用只读 sandbox 与独立空目录，并被明确约束不得调用工具、读写文件或访问网络。

## 环境要求

- macOS
- Node.js `22.13.0` 或更高版本
- 以下任一可用的 Codex binary：
  - Codex CLI
  - Codex Desktop
  - ChatGPT Desktop 内置的 Codex binary

SQLite 使用 Node.js 与 Electron 均内置的 `node:sqlite`，开发、测试和打包无需切换原生模块 ABI。

## 从源码运行

```bash
git clone https://github.com/hugozhou-ai/synapse.git
cd synapse
npm install
npm run dev
```

## 首次设置

1. 首次启动且尚未处理 Hook 设置时，Synapse 会自动打开设置引导。也可从挂件齿轮或 Tray 进入“设置 → Codex Hook”。
2. 点击“安装 Hook”。Synapse 会备份并原子合并 `~/.codex/hooks.json`，同时在 `[features]` 中启用规范的 `hooks = true`。
3. 在安全确认框中检查完整命令与三个 Hook 事件，然后点击“信任并启用”。也可在 Codex 中输入 `/hooks` 检查它们的状态。
4. 新建或恢复一个 Codex 任务。提交 prompt 后，挂件应立即显示进行中；任务停止后，卡片会置顶并出现“总结”。
5. 选择 turns、整理方案和模型，生成草稿；编辑并确认 final 后，可在历史中检索、重新生成或导出。

如需 Apple Notes，在设置中选择目标账户与文件夹，并在 macOS 首次权限提示中允许 Synapse 控制“便签”。

卸载 Hook 只会删除 manifest 中标记的 Synapse handlers，用户原有的 Hook 配置会保留。

## 本地数据与隐私

Synapse 将 Hook 提供的完整 prompt、assistant 内容、事件最小元数据和总结版本保存在本机，用于任务队列与后续整理。运行日志不会记录 prompt、会话正文或总结正文。

| 数据 | 默认位置 |
| --- | --- |
| SQLite 数据库 | `~/Library/Application Support/Synapse/synapse.sqlite3` |
| Hook relay | `~/Library/Application Support/Synapse/bin/codex-hook-relay.sh` |
| Unix socket | `~/Library/Application Support/Synapse/run/hook.sock` |
| 运行日志 | `~/Library/Application Support/Synapse/logs/synapse.log` |
| 离线事件 | `~/Library/Application Support/Synapse/spool/` |
| Hook manifest 与备份 | `~/Library/Application Support/Synapse/` |

## 验证与构建

运行完整质量检查：

```bash
npm run check
npm run build
```

`npm run check` 会执行 TypeScript 类型检查、架构依赖检查和自动化测试。测试使用 Fake App Server、临时 SQLite 和临时 Codex 配置目录，不会修改真实的 `~/.codex`，也不会消耗 Codex 额度。

生成 macOS DMG 与 ZIP：

```bash
npm run package:mac
```

正式分发前，需要在 Electron Builder 环境中配置 Developer ID 签名与公证凭据；[`build/entitlements.mac.plist`](build/entitlements.mac.plist) 已包含 Apple Events entitlement。

## 架构

```text
Renderer / Preload / IPC
          ↓
Application Services
          ↓
Domain Aggregates / Domain Services
          ↓
Ports ← Infrastructure Adapters
```

领域层不依赖 Electron、Node、SQLite 或外部协议，主进程是唯一的 Composition Root。App Server 使用稳定的 `stdio` JSONL transport。更多实现细节见：

- [架构与领域边界](docs/architecture.md)
- [macOS 人工验收清单](docs/manual-verification.md)
- [Codex Hooks 文档](https://learn.chatgpt.com/docs/hooks)
- [Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)
