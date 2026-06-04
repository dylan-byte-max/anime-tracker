// 腾讯视频动漫 - 列表 + 详情热度 + 排序
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

async function fetchList(pageIndex=0, prevContext={}) {
  const url = 'https://pbaccess.video.qq.com/trpc.multi_vector_layout.mvl_controller.MVLPageHTTPService/getMVLPage?&vversion_platform=2';
  const body = pageIndex === 0
    ? { page_params:{ channel_id:"100119", filter_params:"sort=75", page_id:"channel_list", page_type:"operation" } }
    : { page_params:{ channel_id:"100119", filter_params:"sort=75", page_type:"operation", page_id:"channel_list" }, page_context: prevContext };
  const res = await fetch(url, {
    method:'POST',
    headers: { 'Content-Type':'application/json', 'User-Agent': UA, 'Origin':'https://v.qq.com', 'Referer':'https://v.qq.com/' },
    body: JSON.stringify(body)
  });
  return res.json();
}

function findPosters(obj, depth=0, out=[]) {
  if (!obj || typeof obj !== 'object' || depth > 14) return out;
  if (Array.isArray(obj)) { obj.forEach(o => findPosters(o, depth+1, out)); return out; }
  if (obj.title && typeof obj.title === 'string' && obj.cid && obj.title.length < 40) {
    out.push(obj);
    return out;
  }
  for (const k of Object.keys(obj)) findPosters(obj[k], depth+1, out);
  return out;
}

async function fetchDetail(cid) {
  const url = 'https://pbaccess.video.qq.com/trpc.vector_layout.page_view.PageService/getPage?video_appid=3000010&vversion_platform=2';
  const body = {
    page_params:{
      req_from:"web_vsite", new_mark_label_enabled:"1", cid, is_pc_new_detail_page:"0", is_from_web_flyflow:"1"
    },
    page_bypass_params:{ params:{ caller_id:"3000010", platform_id:"2" }, scene:"desk_detail", app_version:"" },
    page_context:{}
  };
  const res = await fetch(url, {
    method:'POST',
    headers: { 'Content-Type':'application/json', 'User-Agent': UA, 'Origin':'https://v.qq.com', 'Referer':'https://v.qq.com/' },
    body: JSON.stringify(body)
  });
  const j = await res.json();

  // 深度搜索找含 hot_num/detail_info 的对象（params 块）
  function findParams(o, depth=0) {
    if (!o || typeof o !== 'object' || depth > 14) return null;
    if (o.hot_num !== undefined || o.detail_info !== undefined) return o;
    if (Array.isArray(o)) { for (const x of o) { const r = findParams(x, depth+1); if (r) return r; } return null; }
    for (const k of Object.keys(o)) { const r = findParams(o[k], depth+1); if (r) return r; }
    return null;
  }
  const p = findParams(j) || {};

  const heat = parseInt((p.hot_num || '0').toString().replace(/\D/g,'')) || 0;
  const detail_info = (p.detail_info || '').replace(/<[^>]+>/g, '').trim();   // 反转义后干净

  // 完结状态：detail_info 含 "全N集" 强证据；matrix_infos.updated_info 也可能
  const cleanDetail = detail_info.replace(/\s/g,'');
  let status = '连载中';
  if (/全\d+集|全\d+话|完结|大结局/.test(cleanDetail)) status = '已完结';
  if (cleanDetail.includes('更新至') && !cleanDetail.match(/全\d+集/)) status = '连载中';
  // matrix_infos 是个 JSON 字符串，里面也有 updated_info
  if (p.matrix_infos) {
    try {
      const mi = typeof p.matrix_infos === 'string' ? JSON.parse(p.matrix_infos) : p.matrix_infos;
      const upd = mi?.updated_info?.first_page || mi?.updated_info?.second_page || '';
      if (/全\d+集|完结|大结局/.test(upd) && !/更新至/.test(upd)) status = '已完结';
    } catch(e) {}
  }
  // 总集数 vs 当前集数
  const updateTo = parseInt(detail_info.match(/更新至(\d+)集/)?.[1] || '0');
  const allEp = parseInt(detail_info.match(/全(\d+)集/)?.[1] || '0');
  if (updateTo && allEp && updateTo >= allEp) status = '已完结';

  // 提取最干净的 latest 显示
  let latest = '';
  const segs = detail_info.split('·').map(s=>s.trim()).filter(Boolean);
  // 优先找 "全xx集"，其次 "更新至xx集"
  const ep = segs.find(s => /^全\d+/.test(s)) || segs.find(s => /^更新至/.test(s));
  if (ep) latest = ep;

  return {
    heat,
    detail_info,
    latest,
    status,
    description: p.description || p.introduction || '',
    cover_year: p.cover_year || '',
    main_genres: p.main_genres || '',
    second_genres: p.second_genres || '',
    series_name: p.series_name || '',
    tags: p.tags || '',
    onlineTime: p.hollywood_online || p.online_time || p.publish_date || '',
    episode_all: parseInt(p.episode_all || '0'),
  };
}

async function scrapeListAll(maxItems=120) {
  const all = [];
  const seen = new Set();
  let context = {};
  for (let p=0; p<15; p++) {
    let j;
    try { j = await fetchList(p, context); } catch(e) { console.error(' page',p,'fail',e.message); break; }
    const cards = findPosters(j);
    let added = 0;
    for (const c of cards) {
      if (!seen.has(c.cid)) { seen.add(c.cid); all.push(c); added++; }
    }
    console.log(`  page ${p}: cards=${cards.length}, added=${added}, total=${all.length}`);
    if (added === 0 || all.length >= maxItems) break;
    context = {
      "_ctrl_page_index": String(p+1),
      "_ctrl_showed_module_num": String(p+1),
      "_ds_cli_6970df954e7a9803_poster_offset": String((p+1)*12),
      "_ds_cli_6970df954e7a9803_poster_size": "12",
      "_merger_mod_cnt": String(p+1),
      "page_index": String(p+1)
    };
    await new Promise(r=>setTimeout(r, 500));
  }
  return all;
}

(async () => {
  console.log('=== 阶段一：列表 ===');
  const list = await scrapeListAll(120);
  console.log('列表:', list.length);

  console.log('\n=== 阶段二：详情热度 ===');
  const enriched = [];
  for (let i=0; i<list.length; i++) {
    const it = list[i];
    process.stdout.write(`  [${i+1}/${list.length}] ${it.title}... `);
    try {
      const det = await fetchDetail(it.cid);
      enriched.push({ ...it, ...det });
      console.log(`heat=${det.heat}`);
    } catch(e) {
      console.log('skip', e.message);
      enriched.push({ ...it, heat:0 });
    }
    await new Promise(r=>setTimeout(r, 350));
  }

  enriched.sort((a,b) => (b.heat||0) - (a.heat||0));

  // 二次确认 status：列表的 timelong 是最新更新状态，优先于 detail_info
  enriched.forEach(it => {
    const tl = (it.timelong || '').trim();
    if (/^更新至\d+/.test(tl)) it.status = '连载中';
    else if (/^全\d+|集全|话全/.test(tl)) it.status = '已完结';
  });

  const out = enriched.slice(0, 100).map((it, i) => {
    const tagList = (it.tags||'').split(/[,，]/).filter(Boolean);
    const allTags = [...new Set([it.main_genres, ...((it.second_genres||'').split(/[,，]/)), ...tagList].filter(Boolean))]
                    .filter(t => !/^(内地|日本|韩国|美国|台湾|香港|动画|2D|3D)$/.test(t));
    return {
      rank: i+1,
      cid: it.cid,
      title: it.title,
      cover: it.new_pic_vt || it.new_pic_hz,
      link: `https://v.qq.com/x/cover/${it.cid}.html`,
      score_label: '热度',
      platform_score: it.heat || '',
      score_raw: it.heat || 0,
      score: null,
      latest: (() => {
        // 优先 timelong（列表最新数据，"更新至143集" 这种）
        const tl = (it.timelong || '').trim();
        if (/^更新至|^全\d+|话全|集全/.test(tl)) return tl;
        return it.latest || '';
      })(),
      status: it.status || '连载中',
      tags: allTags.slice(0, 6),
      year: it.cover_year || it.year || (it.publish_date||'').slice(0,4),
      pub_time: it.onlineTime || it.publish_date || '',
      region: it.gen_area_name || it.area_name || '',
      synopsis: it.description || it.second_title || '',
      ip_origin: '',  // 腾讯没直接的IP来源标签，留空
      tagline: it.third_title || '',
      badge: '',
      rank_change: null,
    };
  });

  fs.writeFileSync(path.join(__dirname,'..','data','tencent.json'), JSON.stringify(out, null, 2));
  console.log('\n✅ tencent.json 写入', out.length, '条');
  out.slice(0,5).forEach(x=>console.log(' ', x.rank, x.title, '|热度', x.platform_score, '|', x.year, '|', x.tags.join(','), '|', x.status, x.latest));
})();
