const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

async function fetchIndexPage(seasonType, page=1) {
  const url = `https://api.bilibili.com/pgc/season/index/result?st=${seasonType}&order=2&season_version=-1&spoken_language_type=-1&area=-1&is_finish=-1&copyright=-1&season_status=-1&season_month=-1&year=-1&style_id=-1&sort=0&page=${page}&season_type=${seasonType}&pagesize=20&type=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': seasonType === 4 ? 'https://www.bilibili.com/guochuang/' : 'https://www.bilibili.com/anime/' } });
  return res.json();
}

async function fetchDetail(seasonId) {
  const url = `https://api.bilibili.com/pgc/view/web/season?season_id=${seasonId}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': `https://www.bilibili.com/bangumi/play/ss${seasonId}` } });
  const j = await res.json();
  return j.result || {};
}

function parseEpisodes(idx) {
  if (!idx) return { status:'未知', latest:'' };
  if (idx.startsWith('全')) return { status:'已完结', latest: idx };
  if (idx.startsWith('更新至')) return { status:'连载中', latest: idx };
  return { status:'未知', latest: idx };
}

async function scrape(seasonType, label, max=100) {
  const items = [];
  for (let p=1; p<=Math.ceil(max/20); p++) {
    const j = await fetchIndexPage(seasonType, p);
    if (!j.data || !j.data.list) break;
    for (const it of j.data.list) {
      if (items.length >= max) break;
      items.push(it);
    }
    if (!j.data.has_next) break;
    await new Promise(r=>setTimeout(r, 500));
  }
  console.log(`[${label}] 列表收到 ${items.length} 条`);

  // 详情
  const out = [];
  for (let i=0; i<items.length; i++) {
    const it = items[i];
    const ep = parseEpisodes(it.index_show);
    let detail = {};
    try {
      detail = await fetchDetail(it.season_id);
    } catch(e) { console.error('detail fail', it.title); }
    const stat = detail.stat || {};
    out.push({
      rank: i+1,
      season_id: it.season_id,
      media_id: it.media_id,
      title: it.title,
      cover: it.cover,
      link: it.link,
      sub_title: it.subTitle,
      status: ep.status,
      latest: ep.latest,
      score_label: '播放量',
      platform_score: it.order,            // "114.5亿次播放"
      score_raw: stat.views || 0,           // 数字
      score: it.score,                       // 评分
      follow_count: stat.follow_text || (stat.favorites ? `${(stat.favorites/10000).toFixed(0)}万` : ''),
      tags: detail.styles || [],
      year: detail.publish?.pub_time ? detail.publish.pub_time.slice(0,4) : '',
      pub_time: detail.publish?.pub_time || '',
      region: (detail.areas && detail.areas[0]?.name) || '',
      synopsis: detail.evaluate || '',
      series: detail.series?.series_title || '',
      // IP 来源（"小说改"/"漫画改" 在 styles 里）
      ip_origin: (detail.styles||[]).find(s=>/改$|原创/.test(s)) || '',
      total: it.order,
      badge: it.badge,
      rank_change: null,
    });
    if (i % 5 === 4) console.log(`  详情 ${i+1}/${items.length}`);
    await new Promise(r=>setTimeout(r, 350));
  }
  return out;
}

function looksDegraded(items) {
  // 若 top1 播放量 < 5亿且远小于历史峰值（柯南 20+亿、鬼灭 12亿），多半是海外 IP 简版
  if (!items.length) return true;
  const top1Raw = items[0].score_raw || 0;
  // 5 亿 阈值；并且 top10 里居然没出现"柯南/鬼灭/蜡笔小新/咒术回战/海贼王/航海王/全职猎人"任意一个，视为降级
  const HIGH_THRESHOLD = 500_000_000;
  const expectedKeywords = ['柯南','鬼灭','蜡笔小新','咒术','海贼','航海王','间谍过家家','银魂'];
  const top10Titles = items.slice(0,10).map(x=>x.title).join(' ');
  const hasExpected = expectedKeywords.some(k => top10Titles.includes(k));
  return top1Raw < HIGH_THRESHOLD && !hasExpected;
}

function loadExisting(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e) { return null; }
}

(async () => {
  const guochuangPath = path.join(__dirname,'..','data','bili-guochuang.json');
  const bangumiPath = path.join(__dirname,'..','data','bili-bangumi.json');

  const guochuang = await scrape(4, 'B站国创', 100);
  const bangumi = await scrape(1, 'B站番剧', 100);

  // 防御：海外 IP 降级响应保护
  const guochuangOld = loadExisting(guochuangPath);
  const bangumiOld = loadExisting(bangumiPath);

  function writeWithGuard(label, fresh, old, file) {
    if (looksDegraded(fresh)) {
      if (old && old.length >= 50 && !looksDegraded(old)) {
        console.warn(`⚠️ [${label}] 检测到疑似海外 IP 降级响应（top1=${fresh[0]?.title}/${fresh[0]?.platform_score}）→ 保留旧数据 ${old.length} 条不覆盖`);
        return;
      } else {
        console.warn(`⚠️ [${label}] 新数据可疑但旧数据也可疑，强制写入新数据`);
      }
    }
    fs.writeFileSync(file, JSON.stringify(fresh, null, 2));
    console.log(`✅ [${label}] 已写入 ${fresh.length}`);
  }

  writeWithGuard('B站国创', guochuang, guochuangOld, guochuangPath);
  writeWithGuard('B站番剧', bangumi, bangumiOld, bangumiPath);
})();
