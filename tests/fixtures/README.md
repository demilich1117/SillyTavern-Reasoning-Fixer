# 上游测试摘录

仅测试使用，不导入扩展运行时代码或交付包。保留原函数内容，测试加载器提供明确依赖替身。上游代码以 AGPL-3.0 提供，版权归相应贡献者；原注释保留。见本项目 [LICENSE](../../LICENSE) 和各上游 LICENSE。

## SillyTavern

来源：[SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern/tree/06bde939fb1e9c4c8d8641d810f0a916b5bce127)，版本 1.19.0。

| 摘录文件 | 原文件 / 符号 | 原文件 SHA-256 |
|---|---|---|
| st-message-formatting.txt | public/script.js / messageFormatting | `955C603D0BAD84BAC5A716F0818D85C2543E44D4C43878E0D63EF1E55CA91855` |
| st-message-formatter.txt | public/scripts/message-formatter.js | `F09A5F5051B8DAB6CE5F3A53889C29334804B0ECE04B64B8BFED96B0E480A16D` |
| st-sanitize-hooks.txt | public/scripts/chats.js / addDOMPurifyHooks | `2B870D44C55F99C622B5AFCD7B1FD563219B9444BC70E8653611327D6E7F7BE6` |

## TauriTavern

来源：[Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern/tree/f6126b4fc9243eb3990f2c0bad86e2afcb502f22)，版本 2.3.0。

| 摘录文件 | 原文件 / 符号 | 原文件 SHA-256 |
|---|---|---|
| tt-message-formatting.txt | src/script.js / messageFormatting | `3D12FA1991EE5F76C27630CA459FA9FF80DEDE081B5A22A398C25964FE4C43EB` |
| tt-sanitize-hooks.txt | src/scripts/chats.js / addDOMPurifyHooks | `B844412BA9B700D5ECCA943A8F48D2EA302EA94E86B53661813EDE926114DE54` |

下载核验日期 2026-10-22。更新适配时固定新提交、重新摘录函数并更新散列与测试；不要只改测试替身让旧断言通过。
