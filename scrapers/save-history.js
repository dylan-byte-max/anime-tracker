/**
 * save-history.js — 把当天最新榜单存一份到 history 目录 + 更新索引
 * 由 run-local.ps1 在 4 个爬虫跑完后统一调用：node scrapers/save-history.js
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const PLATFORMS = ['tencent', 'youku', 'bili-guochuang', 'bili-bangumi', 'iqiyi'];

// 北京时间日期（脚本在国内机器/UTC 都能对）
function todayBeijing() {
  const now = new Date(Date.now() + 8 * 3600 * 1000); // 转北京
  return now.toISOString().slice(0, 10);
}
const date = todayBeijing();

for (const p of PLATFORMS) {
  const latestFile = path.join(DATA, `${p}.json`);
  if (!fs.existsSync(latestFile)) continue;
  let content = fs.readFileSync(latestFile, 'utf8');
  // 校验非空 JSON
  try {
    const arr = JSON.parse(content);
    if (!Array.isArray(arr) || arr.length === 0) {
      console.warn(`⚠️ [${p}] 最新数据为空，跳过快照`);
      continue;
    }
  } catch (e) {
    console.warn(`⚠️ [${p}] JSON 解析失败，跳过快照`);
    continue;
  }
  const histDir = path.join(DATA, p, 'history');
  if (!fs.existsSync(histDir)) fs.mkdirSync(histDir, { recursive: true });
  fs.writeFileSync(path.join(histDir, `${date}.json`), content);
  console.log(`✅ [${p}] 快照已存 ${date}`);
}

// 重建索引
const index = {};
for (const p of PLATFORMS) {
  const histDir = path.join(DATA, p, 'history');
  if (!fs.existsSync(histDir)) { index[p] = []; continue; }
  index[p] = fs.readdirSync(histDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .sort()
    .reverse();
}
fs.writeFileSync(path.join(DATA, 'history-index.json'), JSON.stringify(index, null, 2));
console.log(`✅ 索引已更新（${date}）`);
