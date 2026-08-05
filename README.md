# SillyTavern Reasoning Fixer

SillyTavern 前端扩展，用于修复模型把正文或结构化输出错误放进 Reasoning 块的问题。

## 工作原理

扩展会从 Reasoning 块中找到第一个配置的起始标签，然后把从该标签开始直到 Reasoning 末尾的全部内容整体迁移到正文，内部的嵌套标签会原样保留。

例如 Reasoning 中有：

```text
先分析剧情……
<content>正文</content>
```

迁移后 `<content>正文</content>` 会被移到正文中；前面的推理文字仍会保留在Reasoning。

对于 MVU 等多标签结构，只需填写可能作为最外层起点的标签（如 `<content>`）；其中的 `<Analystic>`、`<JsonPatch>` 等内部标签会随整段一起迁移，不需要逐个配置。

插件还会自动处理消息正文开头的常见 reasoning 包裹：

```text
<think>分析过程</think>正文
```

## 安装

### 从 GitHub 安装（推荐）

在 SillyTavern 的 `Extensions → Install extension` 中填写本仓库地址：

```text
https://github.com/demilich1117/SillyTavern-Reasoning-Fixer
```

### 从本地目录安装

将本项目目录复制到 SillyTavern 的第三方扩展目录：

```text
<SillyTavern>/public/scripts/extensions/third-party/SillyTavern-Reasoning-Fixer
```

刷新页面后在 Extensions 面板即可看到 **Reasoning Fixer**。

> 扩展只使用 SillyTavern 自身的前端事件和数据 API，不需要额外端口。

## 功能概览

### 折叠式面板

扩展 UI 与 SillyTavern 其他扩展一致，默认折叠。展开后分为四个可折叠区域：

| 区域 | 说明 |
|------|------|
| **基本设置** | 启用/禁用扩展、自动修复、切换聊天时修复历史消息、调试日志 |
| **档案管理** | 当前聊天档案选择、档案编辑器（名称、标签、选项）、档案增删复制 |
| **预设绑定** | 将档案绑定到特定 API 预设，切换预设时自动切换档案 |
| **手动操作** | 一键修复当前聊天的全部历史消息 |

### 配置档案

支持创建多组可命名的标签配置档案。每个档案可以设置：

- 起始标签列表（哪些标签作为迁移起点）
- 是否保留标签本身（可逐个控制）
- 是否大小写敏感
- 是否允许嵌套标签
- 全局保留标签开关

档案选择优先级：

```text
当前聊天手动选择 > 当前预设绑定 > 全局默认档案
```

### 标签保留控制

每个起始标签的"保留标签"选项可以单独关闭。例如，将 `content` 设置为不保留标签后：

```text
<content>正文</content>  →  正文
```

## 安全行为

- 只处理角色消息，不修改用户消息
- 找到起始标签后直接迁移到末尾，内部标签原样保留
- 重复收到事件不会重复追加同一内容
- 不会修改 SillyTavern 核心源码
- 不会把无标记的 Reasoning 内容猜测为正文

## 开发与测试

需要 Node.js 20+：

```bash
npm test
```

测试覆盖标准 reasoning 包裹、结构化标签迁移、保留/剥离标签、大小写、未闭合保护、swipe 数据和配置档案优先级。

## License

AGPL-3.0-or-later。详见 [LICENSE](./LICENSE)。
