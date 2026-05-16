import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { cli, Strategy } from "@jackwener/opencli/registry";
function parseAlbumUrl(rawUrl) {
  let url = rawUrl.trim();
  if (url.startsWith('"') && url.endsWith('"') || url.startsWith("'") && url.endsWith("'")) {
    url = url.slice(1, -1).trim();
  }
  if (url.startsWith("mp.weixin.qq.com/") || url.startsWith("//mp.weixin.qq.com/")) {
    url = "https://" + url.replace(/^\/+/, "");
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "mp.weixin.qq.com") return null;
    const biz = parsed.searchParams.get("__biz");
    const albumId = parsed.searchParams.get("album_id");
    const scene = parsed.searchParams.get("scene") || "126";
    if (!biz || !albumId) return null;
    return { biz, albumId, scene };
  } catch {
    return null;
  }
}
function isLocalIndexPath(rawUrl) {
  let p = rawUrl.trim();
  if (p.startsWith('"') && p.endsWith('"') || p.startsWith("'") && p.endsWith("'")) {
    p = p.slice(1, -1).trim();
  }
  if (p.endsWith(".md") && fs.existsSync(p)) {
    return path.resolve(p);
  }
  return null;
}
const API_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest"
};
function parseArticleList(list) {
  if (!list) return [];
  if (Array.isArray(list)) return list;
  if (typeof list === "object" && "title" in list && "url" in list) return [list];
  return Object.values(list).filter(
    (item) => item !== null && typeof item === "object" && "title" in item
  );
}
async function fetchAlbumPage(biz, albumId, count, cursor) {
  let apiUrl = `https://mp.weixin.qq.com/mp/appmsgalbum?action=getalbum&__biz=${encodeURIComponent(biz)}&album_id=${encodeURIComponent(albumId)}&count=${count}&f=json`;
  if (cursor) {
    apiUrl += `&begin_msgid=${cursor.msgid}&begin_itemidx=${cursor.itemidx}`;
  }
  const response = await fetch(apiUrl, { headers: API_HEADERS });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  const text = await response.text();
  const data = JSON.parse(text);
  if (data.base_resp?.ret !== 0) throw new Error(`API error: ${data.base_resp?.ret}`);
  return {
    articles: parseArticleList(data.getalbum_resp?.article_list),
    albumTitle: data.getalbum_resp?.base_info?.title || albumId,
    continueFlag: data.getalbum_resp?.continue_flag === "1"
  };
}
function sanitizeTitle(title) {
  return title.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim().slice(0, 200);
}
async function downloadArticle(articleUrl, outputDir) {
  const args = [
    "weixin",
    "download",
    "--url",
    articleUrl,
    "--output",
    outputDir
  ];
  return new Promise((resolve) => {
    const proc = spawn("opencli", args, {
      stdio: ["pipe", "inherit", "inherit"]
    });
    proc.on("exit", (code) => {
      if (code === 0) {
        const localPath = findLatestMd(outputDir);
        resolve({ success: true, localPath });
      } else {
        resolve({ success: false, localPath: null });
      }
    });
    proc.on("error", () => {
      resolve({ success: false, localPath: null });
    });
  });
}
function findLatestMd(dir) {
  let latest = null;
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md") && !entry.name.endsWith(".d.md")) {
        const stat = fs.statSync(full);
        if (!latest || stat.mtimeMs > latest.mtime) {
          latest = { path: full, mtime: stat.mtimeMs };
        }
      }
    }
  }
  walk(dir);
  return latest ? latest.path : null;
}
function parseIndexMd(indexPath) {
  const content = fs.readFileSync(indexPath, "utf-8");
  const lines = content.split("\n");
  const entries = [];
  let albumTitle = path.basename(indexPath, ".md");
  for (const line of lines) {
    if (!line.startsWith("|") || line.includes("---")) continue;
    const cols = line.split("|").map((c) => c.trim());
    if (cols.length >= 6 && cols[1] && /^\d+$/.test(cols[1])) {
      entries.push({
        index: parseInt(cols[1], 10),
        title: cols[2] || "",
        url: cols[3] || "",
        localPath: cols[4] && cols[4] !== "" ? cols[4] : null,
        publishTime: cols[5] || ""
      });
    }
  }
  return { albumTitle, entries };
}
function updateMdLocalPath(indexPath, index, localPath) {
  const content = fs.readFileSync(indexPath, "utf-8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`| ${index} |`) || lines[i].startsWith(`| ${index}  |`)) {
      const cols = lines[i].split("|");
      if (cols.length >= 6) {
        cols[4] = ` ${localPath} `;
        lines[i] = cols.join("|");
        break;
      }
    }
  }
  fs.writeFileSync(indexPath, lines.join("\n"), "utf-8");
}
cli({
  site: "weixin",
  name: "download-album",
  description: "\u83B7\u53D6\u5FAE\u4FE1\u516C\u4F17\u53F7\u5408\u96C6\u6587\u7AE0\u5217\u8868\uFF0C\u81EA\u52A8\u4E0B\u8F7D\u5168\u90E8\u5E76\u751F\u6210\u5E26\u672C\u5730\u8DEF\u5F84\u7684 Markdown \u7D22\u5F15\uFF08\u652F\u6301\u589E\u91CF\u4E0B\u8F7D\uFF09",
  domain: "mp.weixin.qq.com",
  strategy: Strategy.PUBLIC,
  access: "write",
  args: [
    { name: "url", required: true, help: "WeChat album URL or existing index MD file path" },
    { name: "output", default: "./weixin-albums", help: "Output directory" },
    { name: "batch-size", type: "number", default: 20, help: "Articles per API call (max 20)" }
  ],
  columns: ["title", "url", "create_time", "status"],
  func: async (kwargs) => {
    const localIndexPath = isLocalIndexPath(kwargs.url);
    if (localIndexPath) {
      console.error(`
\u{1F4CB} \u589E\u91CF\u4E0B\u8F7D\u6A21\u5F0F: ${localIndexPath}`);
      const { albumTitle: albumTitle2, entries } = parseIndexMd(localIndexPath);
      const outputDir2 = path.dirname(localIndexPath);
      const toDownload2 = entries.filter((e) => !e.localPath);
      const alreadyHave2 = entries.filter((e) => e.localPath);
      console.error(`\u{1F4D6} \u5408\u96C6\u540D\u79F0: ${albumTitle2}`);
      console.error(`\u{1F4CA} \u5DF2\u4E0B\u8F7D: ${alreadyHave2.length} \u7BC7\uFF0C\u5F85\u4E0B\u8F7D: ${toDownload2.length} \u7BC7\uFF0C\u5171 ${entries.length} \u7BC7`);
      if (toDownload2.length === 0) {
        console.error(`\u2705 \u5168\u90E8\u6587\u7AE0\u5DF2\u4E0B\u8F7D\u5B8C\u6210\uFF0C\u65E0\u9700\u7EE7\u7EED
`);
        return entries.map((e) => ({
          title: e.title,
          url: e.url,
          create_time: e.publishTime,
          status: e.localPath ? "downloaded" : "skipped"
        }));
      }
      let successCount2 = alreadyHave2.length;
      const total2 = entries.length;
      console.error(`
\u{1F4E5} \u5F00\u59CB\u4E0B\u8F7D...
`);
      for (let i = 0; i < toDownload2.length; i++) {
        const entry = toDownload2[i];
        const num = entry.index;
        console.error(`\u{1F4CA} \u4E0B\u8F7D\u8FDB\u5EA6: ${successCount2}/${total2} \u7BC7`);
        console.error(`[${num}/${total2}] \u{1F4E5} ${entry.title}`);
        const result = await downloadArticle(entry.url, outputDir2);
        if (result.success && result.localPath) {
          const relativePath = path.relative(outputDir2, result.localPath);
          updateMdLocalPath(localIndexPath, num, relativePath);
          successCount2++;
          console.error(`\u2705 \u6210\u529F \u2192 ${relativePath}
`);
        } else {
          console.error(`\u274C \u5931\u8D25
`);
        }
        if (i < toDownload2.length - 1) {
          const pause = 1e3 + Math.random() * 2e3;
          console.error(`\u23F3 \u7B49\u5F85 ${Math.round(pause / 1e3)}s...
`);
          await new Promise((r) => setTimeout(r, pause));
        }
      }
      console.error(`
\u2705 \u5408\u96C6\u4E0B\u8F7D\u5B8C\u6210: ${successCount2}/${total2} \u7BC7`);
      console.error(`\u{1F4C4} \u7D22\u5F15\u6587\u4EF6: ${localIndexPath}
`);
      return entries.map((e) => ({
        title: e.title,
        url: e.url,
        create_time: e.publishTime,
        status: e.localPath ? "downloaded" : "failed"
      }));
    }
    const parsed = parseAlbumUrl(kwargs.url);
    if (!parsed) {
      return [{ title: "Error", url: "-", create_time: "-", status: "invalid album URL or index path" }];
    }
    const { biz, albumId } = parsed;
    const batchSize = Math.min(kwargs["batch-size"] || 20, 20);
    const allArticles = [];
    let cursor;
    let albumTitle = albumId;
    console.error(`
\u{1F4E6} \u83B7\u53D6\u5408\u96C6: ${albumId}`);
    while (true) {
      const page = await fetchAlbumPage(biz, albumId, batchSize, cursor);
      if (!page.articles || page.articles.length === 0) break;
      if (page.albumTitle && albumTitle === albumId) {
        albumTitle = page.albumTitle;
        console.error(`\u{1F4D6} \u5408\u96C6\u540D\u79F0: ${albumTitle}`);
      }
      allArticles.push(...page.articles);
      const last = page.articles[page.articles.length - 1];
      cursor = { msgid: last.msgid, itemidx: last.itemidx };
      console.error(`\u{1F4E5} ${allArticles.length} \u7BC7 (cursor=${last.msgid})`);
      if (!page.continueFlag) break;
      const pause = 1e3 + Math.random() * 2e3;
      await new Promise((r) => setTimeout(r, pause));
    }
    console.error(`\u2705 \u5171\u6536\u96C6 ${allArticles.length} \u7BC7\u6587\u7AE0\u94FE\u63A5`);
    const safeName = albumTitle.replace(/[\/\\:*?"<>|]/g, "_");
    const outputDir = path.resolve(kwargs.output, safeName);
    fs.mkdirSync(outputDir, { recursive: true });
    const indexPath = path.join(outputDir, `${safeName}.md`);
    let existingEntries = /* @__PURE__ */ new Map();
    if (fs.existsSync(indexPath)) {
      const { entries } = parseIndexMd(indexPath);
      for (const e of entries) {
        if (e.localPath) {
          existingEntries.set(e.index, e.localPath);
        }
      }
      console.error(`\u{1F4CB} \u53D1\u73B0\u5DF2\u6709\u7D22\u5F15: ${existingEntries.size} \u7BC7\u5DF2\u4E0B\u8F7D`);
    }
    if (!fs.existsSync(indexPath)) {
      const header = "| # | \u6807\u9898 | URL | \u672C\u5730\u8DEF\u5F84 | \u53D1\u5E03\u65F6\u95F4 |";
      const separator = "|---|------|-----|---------|---------|";
      const rows = allArticles.map((a, i) => {
        const safeUrl = a.url.replace("http://", "https://");
        const time = a.create_time ? new Date(parseInt(a.create_time, 10) * 1e3).toISOString().slice(0, 10) : "-";
        const existing = existingEntries.get(i + 1) || "";
        return `| ${i + 1} | ${a.title} | ${safeUrl} | ${existing} | ${time} |`;
      });
      const content = [header, separator, ...rows].join("\n") + "\n";
      fs.writeFileSync(indexPath, content, "utf-8");
    }
    console.error(`\u{1F4C4} \u7D22\u5F15\u6587\u4EF6: ${indexPath}
`);
    const toDownload = allArticles.filter((_, i) => !existingEntries.has(i + 1));
    const alreadyHave = allArticles.length - toDownload.length;
    if (toDownload.length === 0) {
      console.error(`\u2705 \u5168\u90E8 ${allArticles.length} \u7BC7\u6587\u7AE0\u5DF2\u4E0B\u8F7D\u5B8C\u6210
`);
      return allArticles.map((a) => ({
        title: a.title,
        url: a.url,
        create_time: a.create_time,
        status: "downloaded"
      }));
    }
    console.error(`\u{1F4E5} \u5F85\u4E0B\u8F7D: ${toDownload.length} \u7BC7\uFF08\u5DF2\u8DF3\u8FC7 ${alreadyHave} \u7BC7\uFF09
`);
    let successCount = alreadyHave;
    const total = allArticles.length;
    console.error(`\u{1F4E5} \u5F00\u59CB\u4E0B\u8F7D...
`);
    for (let i = 0; i < allArticles.length; i++) {
      const article = allArticles[i];
      const num = i + 1;
      if (existingEntries.has(num)) {
        console.error(`\u23ED\uFE0F [${num}/${total}] \u8DF3\u8FC7\uFF08\u5DF2\u5B58\u5728\uFF09: ${article.title}`);
        continue;
      }
      console.error(`\u{1F4CA} \u4E0B\u8F7D\u8FDB\u5EA6: ${successCount}/${total} \u7BC7`);
      console.error(`[${num}/${total}] \u{1F4E5} ${article.title}`);
      const result = await downloadArticle(article.url, outputDir);
      if (result.success && result.localPath) {
        const relativePath = path.relative(outputDir, result.localPath);
        updateMdLocalPath(indexPath, num, relativePath);
        successCount++;
        console.error(`\u2705 \u6210\u529F \u2192 ${relativePath}
`);
      } else {
        console.error(`\u274C \u5931\u8D25
`);
      }
      const remainingDownloads = toDownload.findIndex((a) => a === article);
      if (remainingDownloads < toDownload.length - 1) {
        const pause = 1e3 + Math.random() * 2e3;
        console.error(`\u23F3 \u7B49\u5F85 ${Math.round(pause / 1e3)}s...
`);
        await new Promise((r) => setTimeout(r, pause));
      }
    }
    console.error(`
\u2705 \u5408\u96C6\u4E0B\u8F7D\u5B8C\u6210: ${successCount}/${total} \u7BC7`);
    console.error(`\u{1F4C4} \u7D22\u5F15\u6587\u4EF6: ${indexPath}
`);
    return allArticles.map((a) => ({
      title: a.title,
      url: a.url,
      create_time: a.create_time,
      status: "listed"
    }));
  }
});
