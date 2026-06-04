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

(async () => {
  const guochuang = await scrape(4, 'B站国创', 100);
  fs.writeFileSync(path.join(__dirname,'..','data','bili-guochuang.json'), JSON.stringify(guochuang, null, 2));
  console.log('✅ 国创已写入', guochuang.length);
  const bangumi = await scrape(1, 'B站番剧', 100);
  fs.writeFileSync(path.join(__dirname,'..','data','bili-bangumi.json'), JSON.stringify(bangumi, null, 2));
  console.log('✅ 番剧已写入', bangumi.length);
})();
