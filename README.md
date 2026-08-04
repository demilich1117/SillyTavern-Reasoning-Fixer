# SillyTavern Reasoning Fixer

SillyTavern 前端扩展，用于修复模型把正文或结构化输出错误放进 Reasoning 块的问题。

## 支持的内容

默认档案采用“从第一个配置标签移动到末尾”模式。它会丢弃起始标签之前的原始推理文字，然后把从第一个匹配标签开始直到 Reasoning 末尾的全部内容整体迁移，并保留内部标签：

```text
<novel_header>标题</novel_header>
<content>正文</content>
<table_edit>表格内容</table_edit>
```

例如 Reasoning 中有：

```text
先分析剧情……
<novel_header>标题</novel_header>
<content>正文</content>
<table_edit>表格内容</table_edit>
```

迁移后正文会是从 `<novel_header>` 开始的完整后缀；`content`、`table_edit` 等内部标签不需要逐个填写，Reasoning 会被清空。

对于 MVU 变量，只需填写可能作为最外层起点的标签，例如 `<UpdateVarible>`；其中的 `<Analystic>`、`<JsonPatch>` 等会随整段一起迁移。

扩展仍保留“只移动已闭合的配置标签块”模式，适合需要保留真正推理文字的档案。

插件还会处理消息正文开头的常见 reasoning 包裹：

```text
<think>分析过程</think>正文
```

## 安装

### 从本地目录安装

将本项目目录复制到 SillyTavern 的第三方扩展目录：

```text
<SillyTavern>/public/scripts/extensions/third-party/SillyTavern-Reasoning-Fixer
```

在 SillyTavern 中刷新页面，打开 Extensions 面板即可看到 `Reasoning Fixer`。

### 从 GitHub 安装

将本仓库推送到 GitHub 后，在 SillyTavern 的 `Extensions -> Install extension` 中填写仓库地址。

扩展只使用 SillyTavern 自身的前端事件和数据 API，不需要新增端口。当前本地实例默认地址是 `http://127.0.0.1:8000`。

## 配置档案

扩展支持创建多组可命名的标签配置档案。每个档案可以设置：

- 提取模式（从第一个配置标签迁移到末尾，或只迁移指定完整标签块）；
- 迁移哪些标签；
- 是否保留标签本身；
- 是否大小写敏感；
- 是否允许嵌套标签。

当前聊天可以手动选择档案，也可以让扩展根据当前预设自动选择。优先级为：

```text
当前聊天手动选择 > 当前预设绑定 > 全局默认档案
```

默认标签的“保留标签”选项可以逐个关闭。例如，将 `table_edit` 设置为不保留标签后：

```text
<table_edit>表格内容</table_edit>
```

会迁移为：

```text
表格内容
```

## 安全行为

- 只处理角色消息，不修改用户消息。
- 精确模式只迁移完整的配置标签块；未闭合标签会保留原状。
- 整段模式会在找到起始标签后直接迁移到末尾，即使内部标签尚未闭合；因此只应把稳定的最外层输出标签作为起始标签。
- 重复收到事件不会重复追加同一内容。
- 插件不会修改 SillyTavern 核心源码。
- API 字段已经错位时，插件只能依据显式标签或标准 reasoning 包裹进行判断，不会把一整段无标记 Reasoning 猜测为正文。

## 开发与测试

需要 Node.js 20 或更高版本：

```powershell
npm test
```

测试覆盖标准 reasoning 包裹、结构化标签迁移、保留/剥离标签、大小写、未闭合保护、swipe 数据和配置档案优先级。

## License

AGPL-3.0-or-later。详见 [LICENSE](./LICENSE)。
