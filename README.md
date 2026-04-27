# opencli-weixin-album

opencli plugin — 获取微信公众号合集（Album）的所有文章列表，自动下载全部文章（含图片），生成带本地路径的 Markdown 索引文件。

## 功能

- 自动获取合集全部文章链接（无需 Cookie，直接调用微信 API）
- 自动逐篇下载文章内容和图片（复用 `opencli weixin download`）
- 生成 Markdown 索引文件，下载完成后自动回写本地路径
- 每次翻页 1-3 秒随机暂停，避免触发限流

## 前置要求

- Node.js >= 18
- [opencli](https://github.com/jackwener/opencli) >= 1.3.3
- **Chrome 浏览器** + **opencli Browser Bridge 扩展**（下载文章时需要）

```bash
npm install -g @jackwener/opencli
```

## 安装

```bash
opencli plugin install github:SlowGrowth1314/opencli-weixin-album
```

安装后插件位于 `~/.opencli/plugins/opencli-weixin-album/`。安装过程中会自动完成 npm install、依赖链接和 TypeScript 编译。

## 浏览器扩展配置（必须）

下载文章需要 opencli 通过浏览器访问微信页面，必须安装并连接 Browser Bridge 扩展：

### 1. 安装扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角 **Developer mode**
3. 点击 **Load unpacked**
4. 选择目录：`{node_modules}/@jackwener/opencli/extension/`
   - 全局安装路径示例：`/Users/{用户名}/.nvm/versions/node/v24.14.0/lib/node_modules/@jackwener/opencli/extension/`
5. 确认扩展显示为 **OpenCLI v1.2.6** 且已启用

### 2. 验证连接

```bash
opencli doctor
```

应该看到：

```
[OK] Daemon: running on port 19825
[OK] Extension: connected
[OK] Connectivity: connected in 0.3s
```

如果显示 `[MISSING] Extension: not connected`，请检查：
- 扩展是否已在 Chrome 中启用
- 尝试刷新扩展页面或重启 Chrome

### 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `zsh: permission denied: opencli` | `main.js` 缺少执行权限 | `chmod +x $(which opencli)` 或对 symlink 目标文件执行 `chmod +x` |
| `zsh: parse error near '&'` | URL 中的 `&` 被 shell 解析 | URL 必须用引号包裹 |
| `Package subpath './registry.js' is not defined` | import 路径带了 `.js` 后缀 | 已在新版本修复，更新插件即可 |
| `Browser Extension is not connected` | Chrome 扩展未加载或未连接 | 按上面步骤安装扩展，然后 `opencli doctor` 验证 |

## 使用方法

### 一键下载合集

在微信中打开合集页面，复制 URL，例如：

```
https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzI0NTU3NTc5Ng==&action=getalbum&album_id=4482506796406177793&scene=21#wechat_redirect
```

执行命令（**URL 必须用引号包裹**，防止 shell 解析 `&`）：

```bash
opencli weixin download-album \
  --url "https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzI0NTU3NTc5Ng==&action=getalbum&album_id=4482506796406177793&scene=21#wechat_redirect"
```

运行输出：

```
📦 获取合集: 4482506796406177793
📖 合集名称: 智能体设计模式
📥 4 篇 (cursor=2247484319)
✅ 共收集 4 篇文章链接
📄 已生成索引: ./weixin-albums/智能体设计模式/智能体设计模式.md

[1/4] 📥 下载: 智能体设计模式 - 第一章: 让 AI 不再「一口吃成胖子」
✅ [1/4] 下载成功，已更新本地路径: ...
[2/4] 📥 下载: 智能体设计模式-第二章: 让 AI 学会看情况办事
✅ [2/4] 下载成功，已更新本地路径: ...
...

✅ 合集下载完成: 4/4 篇
📄 索引文件: ./weixin-albums/智能体设计模式/智能体设计模式.md
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

在输出目录下生成以合集名称命名的文件夹，包含索引文件和各篇文章：

```
weixin-albums/
└── 智能体设计模式/
    ├── 智能体设计模式.md                          # 索引文件
    ├── 智能体设计模式_-_第一章_让_AI_不再.../      # 第一章
    │   ├── 智能体设计模式_-_第一章_....md
    │   └── images/
    │       ├── img_001.png
    │       └── ...
    ├── 智能体设计模式-第二章_让_AI_学会.../         # 第二章
    │   ├── 智能体设计模式-第二章_....md
    │   └── images/
    └── ...
```

索引文件内容示例（本地路径列在下载完成后自动填入）：

```markdown
| # | 标题 | URL | 本地路径 | 发布时间 |
|---|------|-----|---------|---------|
| 1 | 智能体设计模式 - 第一章: 让 AI 不再「一口吃成胖子」 | https://mp.weixin.qq.com/s?... | 智能体设计模式_-_第一章.../....md | 2026-04-23 |
| 2 | 智能体设计模式-第二章: 让 AI 学会看情况办事 | https://mp.weixin.qq.com/s?... | 智能体设计模式-第二章.../....md | 2026-04-25 |
```

## 参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `--url` | 是 | - | 微信合集页面 URL（必须用引号包裹） |
| `--output` | 否 | `./weixin-albums` | 输出目录 |
| `--batch-size` | 否 | `20` | 每次 API 请求获取的文章数（上限 20） |

## 技术细节

- **翻页机制**：微信合集 API 使用 cursor-based 分页，通过上一页最后一条文章的 `msgid` 和 `itemidx` 作为游标请求下一页
- **文章列表无需认证**：合集文章列表为公开数据，无需 Cookie 或登录
- **文章下载需要浏览器**：通过 `opencli weixin download` 调用浏览器渲染页面获取完整内容
- **图片下载**：自动下载文章内所有图片到本地 `images/` 目录，Markdown 中图片路径替换为本地相对路径
- **限流保护**：翻页间隔 1-3 秒随机暂停

## License

MIT
