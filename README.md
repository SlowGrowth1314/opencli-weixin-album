# opencli-weixin-album

opencli plugin — 获取微信公众号合集（Album）的所有文章列表，生成 Markdown 索引文件。

## 功能

- 无需 Cookie、无需浏览器，直接调用微信 API 获取合集文章列表
- 支持自动翻页（cursor-based 分页），可获取合集中的全部文章
- 生成 Markdown 表格索引文件，包含标题、URL、本地路径（预留给后续下载）、发布时间
- 每次翻页 1-3 秒随机暂停，避免触发限流

## 前置要求

- Node.js >= 18
- [opencli](https://github.com/jackwener/opencli) >= 1.3.3

```bash
npm install -g @jackwener/opencli
```

## 安装

```bash
opencli plugin install github:SlowGrowth1314/opencli-weixin-album
```

安装后插件位于 `~/.opencli/plugins/opencli-weixin-album/`。安装过程中会自动完成 npm install、依赖链接和 TypeScript 编译。

## 使用方法

### 获取合集文章列表

在微信中打开合集页面，复制 URL，例如：

```
https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzI0NTU3NTc5Ng==&action=getalbum&album_id=4482506796406177793&scene=21#wechat_redirect
```

执行命令（URL 需要用引号包裹，防止 shell 解析 `&`）：

```bash
opencli weixin download-album \
  --url "https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzI0NTU3NTc5Ng==&action=getalbum&album_id=4482506796406177793&scene=21#wechat_redirect"
```

运行后自动输出合集名称和文章数量：

```
📦 获取合集: 4482506796406177793
📖 合集名称: 智能体设计模式
📥 4 篇 (cursor=2247484319)
✅ 共 4 篇文章
📄 已生成: ./weixin-albums/智能体设计模式/智能体设计模式.md
```

### 指定输出目录

```bash
opencli weixin download-album \
  --url "合集URL" \
  --output ./my-articles
```

### 调整每页获取数量

```bash
opencli weixin download-album \
  --url "合集URL" \
  --batch-size 10
```

最大值为 20（微信 API 限制）。

## 输出格式

在输出目录下生成以合集名称命名的文件夹和 Markdown 文件：

```
weixin-albums/
└── 智能体设计模式/
    └── 智能体设计模式.md
```

Markdown 文件内容示例：

```markdown
| # | 标题 | URL | 本地路径 | 发布时间 |
|---|------|-----|---------|---------|
| 1 | 智能体设计模式 - 第一章: 让 AI 不再「一口吃成胖子」 | https://mp.weixin.qq.com/s?... |  | 2026-04-23 |
| 2 | 智能体设计模式-第二章: 让 AI 学会看情况办事 | https://mp.weixin.qq.com/s?... |  | 2026-04-25 |
| 3 | 智能体设计模式-第三章: 能并行就别排队，AI 多线程干活 | https://mp.weixin.qq.com/s?... |  | 2026-04-25 |
| 4 | 智能体设计模式-第四章: 让 AI 学会自己检查作业 | https://mp.weixin.qq.com/s?... |  | 2026-04-26 |
```

**本地路径列**默认为空，预留用于配合 `opencli weixin download` 命令逐篇下载后填写。

## 参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `--url` | 是 | - | 微信合集页面 URL（需用引号包裹） |
| `--output` | 否 | `./weixin-albums` | 输出目录 |
| `--batch-size` | 否 | `20` | 每次 API 请求获取的文章数（上限 20） |

## 配合单篇下载使用

获取文章列表后，可以用 opencli 自带的 `weixin download` 命令逐篇下载：

```bash
opencli weixin download \
  --url "https://mp.weixin.qq.com/s?__biz=xxx&mid=xxx" \
  --output ./weixin-albums/合集名称
```

也可以结合表格中的 URL 列写脚本批量下载。

## 技术细节

- **翻页机制**：微信合集 API 使用 cursor-based 分页，通过上一页最后一条文章的 `msgid` 和 `itemidx` 作为游标请求下一页
- **无需认证**：合集文章列表为公开数据，无需 Cookie 或登录
- **限流保护**：每次翻页间隔 1-3 秒随机暂停

## License

MIT
