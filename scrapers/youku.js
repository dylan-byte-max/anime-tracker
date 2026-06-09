// 优酷动漫 — 列表 + 详情页热度 + 排序
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': PC_UA, 'Referer':'https://www.youku.com/' } });
  return r.text();
}

// === 阶段一：列表聚合 ===
async function aggregateList() {
  // 优酷动漫各子分类入口（每个能撑 ~16-21 个独立动漫）
  const urls = [
    // 精选编排页（含真正的"动漫热度榜·TOPx"卡片，能拿 70+ 候选）
    'https://www.youku.com/ku/webcomic',
    'https://list.youku.com/category/show/cartoon.html',
    'https://list.youku.com/category/show/c_100.html',
    'https://list.youku.com/category/show/c_104.html',
    'https://list.youku.com/category/show/c_85.html',
    'https://list.youku.com/category/show/c_30.html',
    'https://list.youku.com/category/show/c_11.html',
    'https://list.youku.com/category/show/c_87.html',
    'https://list.youku.com/category/show/c_100_a_%E5%9B%BD%E9%A3%8E_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E5%8A%A8%E6%BC%AB_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E7%95%AA%E5%89%A7_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E7%8E%84%E5%B9%BB_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E7%83%AD%E8%A1%80_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E5%85%83%E5%B0%8A_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E4%BB%99%E4%BE%A0_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E5%A5%87%E5%B9%BB_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E7%83%AD%E8%A1%80%E5%86%92%E9%99%A9_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E6%88%98%E6%96%97_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E6%90%9E%E7%AC%91_g__s_1.html',
    'https://list.youku.com/category/show/c_100_a_%E5%92%8C%E9%A3%8E_g__s_1.html',
    'https://list.youku.com/category/show/c_100/_p_3.html',
  ];
  const seen = new Set();
  const all = [];
  for (const u of urls) {
    try {
      const html = await get(u);
      // 模式 A: list.youku.com 类目页 - "独播 漫・更新至79话 沧元图"
      const reA = /href="([^"]+)"[^>]*?aria-label="([^"]*?漫・[^"]+?)"/g;
      let m;
      while ((m = reA.exec(html))) {
        const href = m[1].replace(/&amp;/g,'&');
        const lab = m[2];
        const parts = lab.split('漫・');
        const flag = parts[0].trim();
        const segs = (parts[1]||'').split(/\s+/);
        const episodes = segs[0] || '';
        const title = segs.slice(1).join(' ').trim();
        if (!title || seen.has(title)) continue;
        seen.add(title);
        const link = href.startsWith('//') ? 'https:'+href : href;
        all.push({ flag, episodes, title, link });
      }
      // 模式 B: ku/webcomic 精选 - "VIP 40话全 举国登仙" / "独播 更新至144话 师兄啊师兄"
      // aria-label 是 "[标记 ]?(更新至XX话|XX话全|XX集全|首播 更新至...) (标题)"
      const reB = /href="(\/\/v\.youku\.com\/v_show\/[^"]+|https?:\/\/v\.youku\.com\/v_show\/[^"]+|\/\/v\.youku\.com\/video\?[^"]+)"[^>]*?aria-label="([^"]+)"/g;
      while ((m = reB.exec(html))) {
        const href = m[1].replace(/&amp;/g,'&');
        const lab = m[2].trim();
        // 只要含"更新至" "话全" "集全" "首播 更新至"
        if (!/更新至|话全|集全/.test(lab)) continue;
        // 取最后一段非空白作为标题。先把 episodes 抽出来
        const epMatch = lab.match(/(更新至\d+[话集期]|\d+[话集]全)/);
        if (!epMatch) continue;
        const episodes = epMatch[1];
        // flag 在 episodes 之前；title 在 episodes 之后
        const epIdx = lab.indexOf(episodes);
        const flag = lab.slice(0, epIdx).trim();
        const title = lab.slice(epIdx + episodes.length).trim();
        if (!title || title.length > 50 || seen.has(title)) continue;
        // 过滤剧集（如果 ku/webcomic 混入剧集这种页面里基本是动漫，但为了稳妥过滤明显非动漫）
        if (/^(第\d|EP|预告)/.test(title)) continue;
        seen.add(title);
        const link = href.startsWith('//') ? 'https:'+href : href;
        all.push({ flag, episodes, title, link });
      }
    } catch(e) { console.error('list fail', u, e.message); }
    await new Promise(r=>setTimeout(r, 350));
  }
  return all;
}

// === 阶段二：详情页热度 ===
async function fetchDetail(item) {
  try {
    const html = await get(item.link);
    // 标签 - new-title-feature title 属性，形如 "7250 国创动漫热度榜·TOP1 新国风 仙侠神魔 古风"
    const titleAttr = html.match(/<div class="new-title-feature"[^>]*?title="([^"]+)"/)?.[1] || '';
    // 热度 - 主路径：直接拿 .new-title-heat 内文；fallback：titleAttr 首段纯数字
    let heat = html.match(/class="new-title-heat"[^>]*>([^<]+)</)?.[1] || '';
    if (!heat) {
      const m = titleAttr.match(/^\s*(\d{2,9})\b/);
      if (m) heat = m[1];
    }
    // 解析 title 属性: "6376 动漫热度榜·TOP2 国风剧场 新国风 热血 古风"
    const tagsAll = titleAttr.split(/\s+/).filter(t => t && t !== heat && !/热度榜|TOP\d+/.test(t));
    // 简介 - .video-desc
    const descRaw = html.match(/<div[^>]*class="video-desc[^"]*"[^>]*>([^<]+)</)?.[1] || '';
    const synopsis = descRaw.includes('|') ? descRaw.split('|').slice(1).join('|').trim() : descRaw.trim();
    // 首播日期
    const date = html.match(/datePublished"\s*content="([^"]+)"/)?.[1] || '';
    const year = date.slice(0,4);
    // 总集数 / 完结状态 - 在 选集 区块的"更新至 X/Y 话"
    const epm = html.match(/更新至(\d+)\/(\d+)[话集]/);
    const total = epm ? parseInt(epm[2]) : null;
    const current = epm ? parseInt(epm[1]) : null;
    // 完结判断：优先看 episodes 标签（"更新至xx话/集" -> 连载中；"xx话全/xx集全" -> 已完结）
    let status = '连载中';
    if (/集全|话全|^全/.test(item.episodes)) status = '已完结';
    else if (/^更新至/.test(item.episodes)) status = '连载中';
    else if (total && current && current >= total) status = '已完结';
    // 移除地区/语种从 tags
    const region = tagsAll.find(t => /^(内地|日本|韩国|美国|台湾|香港|英国|欧美)$/.test(t)) || '';
    const cleanTags = tagsAll.filter(t => t !== region).slice(0, 6);
    // 热度榜TOPx
    const rankInfo = titleAttr.match(/动漫热度榜·TOP(\d+)/)?.[1] || '';
    return {
      heat: heat ? parseInt(heat) : 0,
      tags: cleanTags,
      synopsis,
      year,
      pub_time: date,
      region,
      total_ep: total,
      current_ep: current,
      status,
      rank_in_yk: rankInfo ? parseInt(rankInfo) : null,
    };
  } catch(e) {
    console.error('detail fail', item.title, e.message);
    return null;
  }
}

(async () => {
  console.log('=== 阶段一：列表聚合 ===');
  const list = await aggregateList();
  console.log('聚合:', list.length, '条');

  console.log('\n=== 阶段二：详情页热度 ===');
  const enriched = [];
  for (let i=0; i<list.length; i++) {
    const it = list[i];
    process.stdout.write(`  [${i+1}/${list.length}] ${it.title}... `);
    const det = await fetchDetail(it);
    if (det) {
      enriched.push({ ...it, ...det });
      console.log(`heat=${det.heat}`);
    } else {
      console.log('skip');
    }
    await new Promise(r=>setTimeout(r, 400));
  }

  // 按热度倒序，过滤热度为0的（不在优酷动漫热度榜上的）
  enriched.sort((a,b) => (b.heat||0) - (a.heat||0));
  const filtered = enriched.filter(x => x.heat && x.heat > 0);
  console.log(`\n过滤前 ${enriched.length} 条 → 过滤掉热度=0 的 ${enriched.length-filtered.length} 条 → 保留 ${filtered.length} 条`);

  const out = filtered.map((it, i) => ({
    rank: i+1,
    title: it.title,
    cover: '',
    link: it.link,
    score_label: '热度',
    platform_score: it.heat || '',
    score_raw: it.heat || 0,
    score: null,
    latest: it.episodes,
    status: it.status,
    tags: it.tags,
    year: it.year,
    pub_time: it.pub_time,
    region: it.region,
    synopsis: it.synopsis,
    ip_origin: '',  // 优酷详情页没暴露 IP 来源
    tagline: '',
    badge: it.flag,
    rank_change: null,
  }));

  // 保底：如果新结果远少于已有结果（典型场景：海外 IP 被限，全部 heat=0），保留旧数据避免前端"今天没数据"
  const outPath = path.join(__dirname,'..','data','youku.json');
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch(e) {}
  if (prev.length >= 10 && out.length < prev.length * 0.5) {
    console.warn(`\n⚠️  保底触发：新结果 ${out.length} 条 < 旧文件 ${prev.length} 条 × 50%。保留旧数据，不覆盖。`);
    console.warn('   多半是 runner 拿到了海外简版页（detail HTML 缺 new-title-heat / new-title-feature）。');
    console.warn('   建议在国内本机手动跑一遍 push 上去刷新。');
    return;
  }

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\n✅ youku.json 写入', out.length, '条');
  console.log('Top 5:');
  out.slice(0,5).forEach(x=>console.log(' ', x.rank, x.title, '|热度', x.platform_score, '|', x.year, x.region, '|', x.tags.join(','), '|', x.status, x.latest));
})();
