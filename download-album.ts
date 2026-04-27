/**
 * opencli plugin: weixin-album
 *
 * Fetch WeChat Official Account album article list and generate Markdown index.
 *
 * Install:
 *   opencli plugin install github:<user>/opencli-weixin-album
 *
 * Usage:
 *   opencli weixin download-album --url "https://mp.weixin.qq.com/mp/appmsgalbum?__biz=xxx&album_id=xxx"
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
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
// CLI
// ============================================================

cli({
  site: 'weixin',
  name: 'download-album',
  description: '获取微信公众号合集文章列表，生成 Markdown 索引文件',
  domain: 'mp.weixin.qq.com',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'url', required: true, help: 'WeChat album URL' },
    { name: 'output', default: './weixin-albums', help: 'Output directory' },
    { name: 'batch-size', type: 'number', default: 20, help: 'Articles per API call (max 20)' },
  ],
  columns: ['title', 'url', 'create_time', 'status'],
  func: async (_page, kwargs) => {
    const parsed = parseAlbumUrl(kwargs.url);
    if (!parsed) {
      return [{ title: 'Error', url: '-', create_time: '-', status: 'invalid album URL' }];
    }

    const { biz, albumId } = parsed;
    const batchSize = Math.min(kwargs['batch-size'] || 20, 20);
    const allArticles: AlbumArticle[] = [];
    let cursor: { msgid: string; itemidx: string } | undefined;
    let albumTitle = albumId;

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

    console.error(`✅ 共 ${allArticles.length} 篇文章\n`);

    const safeName = albumTitle.replace(/[\/\\:*?"<>|]/g, '_');
    const outputDir = path.resolve(kwargs.output, safeName);
    fs.mkdirSync(outputDir, { recursive: true });

    const header = '| # | 标题 | URL | 本地路径 | 发布时间 |';
    const separator = '|---|------|-----|---------|---------|';
    const rows = allArticles.map((a, i) => {
      const safeUrl = a.url.replace('http://', 'https://');
      const time = a.create_time
        ? new Date(parseInt(a.create_time, 10) * 1000).toISOString().slice(0, 10)
        : '-';
      return `| ${i + 1} | ${a.title} | ${safeUrl} |  | ${time} |`;
    });

    const content = [header, separator, ...rows].join('\n') + '\n';
    const indexPath = path.join(outputDir, `${safeName}.md`);
    fs.writeFileSync(indexPath, content, 'utf-8');

    console.error(`📄 已生成: ${indexPath}\n`);

    return allArticles.map(a => ({
      title: a.title,
      url: a.url,
      create_time: a.create_time,
      status: 'listed',
    }));
  },
});
