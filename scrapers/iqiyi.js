// 爱奇艺动漫热播榜 - Playwright 抓取（生产版）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET = 'https://www.iqiyi.com/list/comic/%E5%85%A8%E9%83%A8%E5%8A%A8%E6%BC%AB.html';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();

  const allItems = [];
  const seen = new Set();
  page.on('response', async (resp) => {
    if (resp.url().includes('videolib/data')) {
      try {
        const j = await resp.json();
        if (j?.data && Array.isArray(j.data)) {
          for (const it of j.data) {
            if ((it.channel_id === 4 || it.channelId === 4) && it.title && !seen.has(it.album_id || it.title)) {
              seen.add(it.album_id || it.title);
              allItems.push(it);
            }
          }
        }
      } catch(e) {}
    }
  });

  console.log('打开页面...');
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
  await page.waitForTimeout(6000);

  // 滚动 - 触发分页加载
  for (let i=0; i<15; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);
    console.log(`  scroll ${i+1}, items=${allItems.length}`);
    if (allItems.length >= 100) break;
  }

  console.log('收集动漫总数:', allItems.length);

  // 补抓：对 hot_score=0 的项目，点进详情页拿 base_info 接口的 heat 数值
  console.log('\n=== 补抓详情页 heat（针对 hot_score=0 的）===');
  const detailPage = await ctx.newPage();
  const heatMap = new Map();  // album_id -> heat
  detailPage.on('response', async (resp) => {
    if (resp.url().includes('/tvg/v2/lw/base_info')) {
      try {
        const j = await resp.json();
        const s = JSON.stringify(j);
        const heat = parseInt(s.match(/"heat":\s*(\d+)/)?.[1] || '0');
        const eid = resp.url().match(/entity_id=(\d+)/)?.[1] || '';
        if (heat > 0 && eid) heatMap.set(eid, heat);
      } catch(e) {}
    }
  });
  const zeroItems = allItems.filter(x => !x.hot_score);
  console.log(`需补抓: ${zeroItems.length} 条`);
  for (let i=0; i<zeroItems.length; i++) {
    const it = zeroItems[i];
    if (!it.page_url) continue;
    try {
      await detailPage.goto(it.page_url, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(()=>{});
      await detailPage.waitForTimeout(3000);
      // base_info 接口用 tv_id 作为 entity_id
      const tvId = String(it.tv_id);
      const albumId = String(it.album_id);
      const heat = heatMap.get(tvId) || heatMap.get(albumId);
      if (heat) it.hot_score = heat;
      console.log(`  [${i+1}/${zeroItems.length}] ${it.title} → heat=${heat||'未抓到'}`);
    } catch(e) { console.error('  fail', it.title, e.message); }
  }
  await detailPage.close();

  // 转换为统一字段
  const out = allItems.map((it, i) => {
    const tags = (it.tag || '').split(';').filter(t => t && !/^(动画|2D|3D|内地|日本|韩国|美国|本周|每周|逐日)$/.test(t)).slice(0, 6);
    const region = (it.tag||'').match(/内地|日本|韩国|美国|台湾|香港/)?.[0] || '';
    const year = it.date?.year || (it.showDate || '').slice(0,4) || '';
    // IP 来源 — 爱奇艺 tag 字段里有"漫画改编"/"文学改编"/"游戏改编"/"原创" 等，统一映射为简短形式
    const rawOrigin = (it.tag||'').match(/漫画改编|文学改编|游戏改编|原创/)?.[0] || '';
    const ipOriginMap = { '漫画改编':'漫画改', '文学改编':'小说改', '游戏改编':'游戏改', '原创':'原创' };
    const ipOrigin = ipOriginMap[rawOrigin] || '';
    const tagline = (it.taglines && it.taglines[0]?.text) || '';
    return {
      title: it.title,
      cover: it.image_url_2x || it.image_url_1x || it.image_cover,
      link: it.page_url,
      score_label: '热度',
      platform_score: it.hot_score || 0,
      score_raw: it.hot_score || 0,
      score: it.sns_score || null,
      latest: it.dq_updatestatus || '',
      status: /集全|话全|^全/.test(it.dq_updatestatus||'') ? '已完结' : '连载中',
      tags,
      year,
      pub_time: it.showDate || '',
      region,
      synopsis: (it.description || it.desc || '').replace(/\n/g, ' ').trim(),
      ip_origin: ipOrigin,
      tagline,
      // 只保留"独播"这种平台独家标记，VIP/超前点播这类不展示
      badge: it.cornerMark === 'exclusive' ? '独播' : '',
      rank_change: null,
    };
  })
  // 按热度排序，无热度的按评分排序到后面
  .sort((a,b) => {
    if (a.score_raw && !b.score_raw) return -1;
    if (!a.score_raw && b.score_raw) return 1;
    if (a.score_raw && b.score_raw) return b.score_raw - a.score_raw;
    return (b.score||0) - (a.score||0);
  })
  .slice(0,100)
  .map((x,i) => ({ rank: i+1, ...x }));

  fs.writeFileSync(path.join(__dirname,'..','data','iqiyi.json'), JSON.stringify(out, null, 2));
  console.log('✅ iqiyi.json 已写入', out.length, '条');
  await browser.close();
})();
