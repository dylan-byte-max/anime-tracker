/**
 * backfill-history.js — 从 git 历史提取每日榜单快照
 * 方案 B：腾讯/优酷全回填（早期海外 IP 也准确），B站/爱奇艺只回填准确版日期
 *
 * 输出：data/<platform>/history/YYYY-MM-DD.json
 * 用法：node scrapers/backfill-history.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

// 平台文件名 -> history 子目录名
const PLATFORMS = {
  'tencent.json': 'tencent',
  'youku.json': 'youku',
  'bili-guochuang.json': 'bili-guochuang',
  'bili-bangumi.json': 'bili-bangumi',
  'iqiyi.json': 'iqiyi',
};

// 方案 B：B站/爱奇艺只从这天起回填（之前是海外 IP 降级版）
const ACCURATE_FROM = {
  'bili-guochuang.json': '2026-06-11',
  'bili-bangumi.json': '2026-06-11',
  'iqiyi.json': '2026-06-11',
  // 腾讯/优酷不限制（全回填）
};

function gitLog(file) {
  // 返回 [{sha, date(YYYY-MM-DD)}]，按时间正序（旧->新）
  const out = execSync(
    `git log --reverse --pretty=format:"%H|%cd" --date=format:"%Y-%m-%d" -- data/${file}`,
    { cwd: ROOT, encoding: 'utf8' }
  ).trim();
  if (!out) return [];
  return out.split('\n').map(line => {
    const [sha, date] = line.split('|');
    return { sha, date };
  });
}

function getFileAtCommit(sha, file) {
  try {
    return execSync(`git show ${sha}:data/${file}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  } catch (e) {
    return null;
  }
}

let totalWritten = 0;
for (const [file, dir] of Object.entries(PLATFORMS)) {
  const histDir = path.join(DATA, dir, 'history');
  if (!fs.existsSync(histDir)) fs.mkdirSync(histDir, { recursive: true });

  const commits = gitLog(file);
  const accurateFrom = ACCURATE_FROM[file];

  // 同一天多次 commit，保留最后一次（最新覆盖）
  const byDate = {};
  for (const c of commits) byDate[c.date] = c.sha; // 正序遍历，后者覆盖前者

  let written = 0, skipped = 0;
  for (const [date, sha] of Object.entries(byDate)) {
    // 方案 B：B站/爱奇艺跳过早于准确日期的快照
    if (accurateFrom && date < accurateFrom) { skipped++; continue; }

    const content = getFileAtCommit(sha, file);
    if (!content) continue;
    // 校验是合法 JSON 且非空
    try {
      const arr = JSON.parse(content);
      if (!Array.isArray(arr) || arr.length === 0) { skipped++; continue; }
    } catch (e) { skipped++; continue; }

    const outFile = path.join(histDir, `${date}.json`);
    fs.writeFileSync(outFile, content);
    written++;
    totalWritten++;
  }
  console.log(`[${dir}] 回填 ${written} 天${accurateFrom ? `（跳过早于 ${accurateFrom} 的 ${skipped} 天降级数据）` : ''}`);
}

console.log(`\n✅ 共回填 ${totalWritten} 个历史快照`);

// 生成索引文件：data/history-index.json，前端用它知道每个平台有哪些日期
const index = {};
for (const dir of Object.values(PLATFORMS)) {
  const histDir = path.join(DATA, dir, 'history');
  if (!fs.existsSync(histDir)) { index[dir] = []; continue; }
  index[dir] = fs.readdirSync(histDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .sort()
    .reverse(); // 最新在前
}
fs.writeFileSync(path.join(DATA, 'history-index.json'), JSON.stringify(index, null, 2));
console.log('✅ 已生成 data/history-index.json');
console.log('   日期范围：', Object.entries(index).map(([k,v]) => `${k}:${v.length}天`).join('  '));
