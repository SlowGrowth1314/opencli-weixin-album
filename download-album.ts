/**
 * opencli plugin: weixin-album
 *
 * Fetch WeChat Official Account album article list, download all articles,
 * and generate Markdown index with local paths.
 *
 * Supports incremental download: pass existing index MD as --url to resume.
 *
 * Install:
 *   opencli plugin install github:SlowGrowth1314/opencli-weixin-album
 *
 * Usage:
 *   opencli weixin download-album --url "https://mp.weixin.qq.com/mp/appmsgalbum?__biz=xxx&album_id=xxx"
 *   opencli weixin download-album --url "./weixin-albums/合集名称/合集名称.md"  # 增量下载
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { cli, Strategy } from '@jackwener/opencli/registry';

// ============================================================
// Types
// ============================================================

interface AlbumUrlParts {
  biz: string;
  albumId: string;
  scene: string;
}

interface AlbumArticle {
  title: string;
  url: string;
  create_time: string;
  msgid: string;
  itemidx: string;
}

interface AlbumPageResult {
  articles: AlbumArticle[];
  albumTitle: string;
  continueFlag: boolean;
}

interface IndexEntry {
  index: number;
  title: string;
  url: string;
  localPath: string | null;
  publishTime: string;
}

// ============================================================
// URL Parsing
// ============================================================

function parseAlbumUrl(rawUrl: string): AlbumUrlParts | null {
  let url = rawUrl.trim();

  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }

  if (url.startsWith('mp.weixin.qq.com/') || url.startsWith('//mp.weixin.qq.com/')) {
    url = 'https://' + url.replace(/^\/+/, '');
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'mp.weixin.qq.com') return null;

    const biz = parsed.searchParams.get('__biz');
    const albumId = parsed.searchParams.get('album_id');
    const scene = parsed.searchParams.get('scene') || '126';

    if (!biz || !albumId) return null;

    return { biz, albumId, scene };
  } catch {
    return null;
  }
}

function isLocalIndexPath(rawUrl: string): string | null {
  let p = rawUrl.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  if (p.endsWith('.md') && fs.existsSync(p)) {
    return path.resolve(p);
  }
  return null;
}

// ============================================================
// API
// ============================================================

const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'X-Requested-With': 'XMLHttpRequest',
};

function parseArticleList(list: unknown): AlbumArticle[] {
  if (!list) return [];
  if (Array.isArray(list)) return list;
  if (typeof list === 'object' && 'title' in list && 'url' in list) return [list as AlbumArticle];
  return Object.values(list).filter(
    (item): item is AlbumArticle => item !== null && typeof item === 'object' && 'title' in item,
  );
}

async function fetchAlbumPage(
  biz: string,
  albumId: string,
  count: number,
  cursor?: { msgid: string; itemidx: string },
): Promise<AlbumPageResult> {
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
    continueFlag: data.getalbum_resp?.continue_flag === '1',
  };
}

// ============================================================
// Article Download (via opencli weixin download)
// ============================================================

function sanitizeTitle(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function downloadArticle(articleUrl: string, outputDir: string): Promise<{ success: boolean; localPath: string | null }> {
  const args = [
    'weixin', 'download',
    '--url', articleUrl,
    '--output', outputDir,
  ];

  return new Promise((resolve) => {
    const proc = spawn('opencli', args, {
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        const localPath = findLatestMd(outputDir);
        resolve({ success: true, localPath });
      } else {
        resolve({ success: false, localPath: null });
      }
    });

    proc.on('error', () => {
      resolve({ success: false, localPath: null });
    });
  });
}

function findLatestMd(dir: string): string | null {
  let latest: { path: string; mtime: number } | null = null;

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md') && !entry.name.endsWith('.d.md')) {
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

// ============================================================
// Markdown Index Parse & Update
// ============================================================

function parseIndexMd(indexPath: string): { albumTitle: string; entries: IndexEntry[] } {
  const content = fs.readFileSync(indexPath, 'utf-8');
  const lines = content.split('\n');
  const entries: IndexEntry[] = [];
  let albumTitle = path.basename(indexPath, '.md');

  // Parse table rows: | # | 标题 | URL | 本地路径 | 发布时间 |
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('---')) continue;
    const cols = line.split('|').map(c => c.trim());
    if (cols.length >= 6 && cols[1] && /^\d+$/.test(cols[1])) {
      entries.push({
        index: parseInt(cols[1], 10),
        title: cols[2] || '',
        url: cols[3] || '',
        localPath: cols[4] && cols[4] !== '' ? cols[4] : null,
        publishTime: cols[5] || '',
      });
    }
  }

  return { albumTitle, entries };
}

function updateMdLocalPath(indexPath: string, index: number, localPath: string): void {
  const content = fs.readFileSync(indexPath, 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`| ${index} |`) || lines[i].startsWith(`| ${index}  |`)) {
      const cols = lines[i].split('|');
      if (cols.length >= 6) {
        cols[4] = ` ${localPath} `;
        lines[i] = cols.join('|');
        break;
      }
    }
  }
  fs.writeFileSync(indexPath, lines.join('\n'), 'utf-8');
}

// ============================================================
// CLI
// ============================================================

cli({
  site: 'weixin',
  name: 'download-album',
  description: '获取微信公众号合集文章列表，自动下载全部并生成带本地路径的 Markdown 索引（支持增量下载）',
  domain: 'mp.weixin.qq.com',
  strategy: Strategy.PUBLIC,
  access: 'write',
  args: [
    { name: 'url', required: true, help: 'WeChat album URL or existing index MD file path' },
    { name: 'output', default: './weixin-albums', help: 'Output directory' },
    { name: 'batch-size', type: 'number', default: 20, help: 'Articles per API call (max 20)' },
  ],
  columns: ['title', 'url', 'create_time', 'status'],
  func: async (kwargs) => {
    // Check if URL is an existing index MD file (incremental mode)
    const localIndexPath = isLocalIndexPath(kwargs.url);

    if (localIndexPath) {
      // Incremental download mode
      console.error(`\n📋 增量下载模式: ${localIndexPath}`);

      const { albumTitle, entries } = parseIndexMd(localIndexPath);
      const outputDir = path.dirname(localIndexPath);

      // Find articles without local path
      const toDownload = entries.filter(e => !e.localPath);
      const alreadyHave = entries.filter(e => e.localPath);

      console.error(`📖 合集名称: ${albumTitle}`);
      console.error(`📊 已下载: ${alreadyHave.length} 篇，待下载: ${toDownload.length} 篇`);

      if (toDownload.length === 0) {
        console.error(`✅ 全部文章已下载完成，无需继续\n`);
        return entries.map(e => ({
          title: e.title,
          url: e.url,
          create_time: e.publishTime,
          status: e.localPath ? 'downloaded' : 'skipped',
        }));
      }

      // Download missing articles
      let successCount = alreadyHave.length;
      const total = entries.length;

      for (let i = 0; i < toDownload.length; i++) {
        const entry = toDownload[i];
        const num = entry.index;
        const remaining = toDownload.length - i;

        console.error(`\n[${num}/${total}] 📥 下载: ${entry.title}`);

        const result = await downloadArticle(entry.url, outputDir);

        if (result.success && result.localPath) {
          const relativePath = path.relative(outputDir, result.localPath);
          updateMdLocalPath(localIndexPath, num, relativePath);
          successCount++;
          console.error(`✅ [${num}/${total}] 下载成功，已更新本地路径: ${relativePath}`);
        } else {
          console.error(`❌ [${num}/${total}] 下载失败: ${entry.title}`);
        }

        if (i < toDownload.length - 1) {
          const pause = 1000 + Math.random() * 2000;
          console.error(`⏳ 等待 ${Math.round(pause / 1000)}s 后继续...`);
          await new Promise(r => setTimeout(r, pause));
        }
      }

      console.error(`\n✅ 合集下载完成: ${successCount}/${total} 篇`);
      console.error(`📄 索引文件: ${localIndexPath}\n`);

      return entries.map(e => ({
        title: e.title,
        url: e.url,
        create_time: e.publishTime,
        status: e.localPath ? 'downloaded' : 'failed',
      }));
    }

    // Full download mode (from album URL)
    const parsed = parseAlbumUrl(kwargs.url);
    if (!parsed) {
      return [{ title: 'Error', url: '-', create_time: '-', status: 'invalid album URL or index path' }];
    }

    const { biz, albumId } = parsed;
    const batchSize = Math.min(kwargs['batch-size'] || 20, 20);
    const allArticles: AlbumArticle[] = [];
    let cursor: { msgid: string; itemidx: string } | undefined;
    let albumTitle = albumId;

    // Step 1: Fetch all article URLs
    console.error(`\n📦 获取合集: ${albumId}`);

    while (true) {
      const page = await fetchAlbumPage(biz, albumId, batchSize, cursor);
      if (!page.articles || page.articles.length === 0) break;

      if (page.albumTitle && albumTitle === albumId) {
        albumTitle = page.albumTitle;
        console.error(`📖 合集名称: ${albumTitle}`);
      }

      allArticles.push(...page.articles);
      const last = page.articles[page.articles.length - 1];
      cursor = { msgid: last.msgid, itemidx: last.itemidx };

      console.error(`📥 ${allArticles.length} 篇 (cursor=${last.msgid})`);

      if (!page.continueFlag) break;

      const pause = 1000 + Math.random() * 2000;
      await new Promise(r => setTimeout(r, pause));
    }

    console.error(`✅ 共收集 ${allArticles.length} 篇文章链接`);

    const safeName = albumTitle.replace(/[\/\\:*?"<>|]/g, '_');
    const outputDir = path.resolve(kwargs.output, safeName);
    fs.mkdirSync(outputDir, { recursive: true });

    // Step 2: Check for existing index (incremental support)
    const indexPath = path.join(outputDir, `${safeName}.md`);
    let existingEntries: Map<number, string> = new Map();

    if (fs.existsSync(indexPath)) {
      const { entries } = parseIndexMd(indexPath);
      for (const e of entries) {
        if (e.localPath) {
          existingEntries.set(e.index, e.localPath);
        }
      }
      console.error(`📋 发现已有索引: ${existingEntries.size} 篇已下载`);
    }

    // Step 3: Generate/update Markdown index
    if (!fs.existsSync(indexPath)) {
      const header = '| # | 标题 | URL | 本地路径 | 发布时间 |';
      const separator = '|---|------|-----|---------|---------|';
      const rows = allArticles.map((a, i) => {
        const safeUrl = a.url.replace('http://', 'https://');
        const time = a.create_time
          ? new Date(parseInt(a.create_time, 10) * 1000).toISOString().slice(0, 10)
          : '-';
        const existing = existingEntries.get(i + 1) || '';
        return `| ${i + 1} | ${a.title} | ${safeUrl} | ${existing} | ${time} |`;
      });
      const content = [header, separator, ...rows].join('\n') + '\n';
      fs.writeFileSync(indexPath, content, 'utf-8');
    }

    console.error(`📄 索引文件: ${indexPath}\n`);

    // Step 4: Download only articles without local path
    const toDownload = allArticles.filter((_, i) => !existingEntries.has(i + 1));
    const alreadyHave = allArticles.length - toDownload.length;

    if (toDownload.length === 0) {
      console.error(`✅ 全部 ${allArticles.length} 篇文章已下载完成\n`);
      return allArticles.map(a => ({
        title: a.title,
        url: a.url,
        create_time: a.create_time,
        status: 'downloaded',
      }));
    }

    console.error(`📥 待下载: ${toDownload.length} 篇（已跳过 ${alreadyHave} 篇）\n`);

    let successCount = alreadyHave;
    const total = allArticles.length;

    for (let i = 0; i < allArticles.length; i++) {
      const article = allArticles[i];
      const num = i + 1;

      // Skip if already downloaded
      if (existingEntries.has(num)) {
        console.error(`⏭️ [${num}/${total}] 已存在，跳过: ${article.title}`);
        continue;
      }

      console.error(`\n[${num}/${total}] 📥 下载: ${article.title}`);

      const result = await downloadArticle(article.url, outputDir);

      if (result.success && result.localPath) {
        const relativePath = path.relative(outputDir, result.localPath);
        updateMdLocalPath(indexPath, num, relativePath);
        successCount++;
        console.error(`✅ [${num}/${total}] 下载成功，已更新本地路径: ${relativePath}`);
      } else {
        console.error(`❌ [${num}/${total}] 下载失败: ${article.title}`);
      }

      // Pause before next download (except for last one)
      const remaining = toDownload.findIndex(a => a === article);
      if (remaining < toDownload.length - 1) {
        const pause = 1000 + Math.random() * 2000;
        console.error(`⏳ 等待 ${Math.round(pause / 1000)}s 后继续...`);
        await new Promise(r => setTimeout(r, pause));
      }
    }

    console.error(`\n✅ 合集下载完成: ${successCount}/${total} 篇`);
    console.error(`📄 索引文件: ${indexPath}\n`);

    return allArticles.map(a => ({
      title: a.title,
      url: a.url,
      create_time: a.create_time,
      status: 'listed',
    }));
  },
});