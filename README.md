# Anime Tracker · 长视频动漫 IP 追踪

每天自动抓取爱奇艺、腾讯视频、优酷、B站国创/番剧的动漫热度数据，前端可视化展示并支持下载 Excel + 自定义热度对标库。

## 数据源

| 平台 | 路径 | 排序依据 |
|---|---|---|
| 爱奇艺 | Playwright 截 `mesh.if.iqiyi.com/portal/lw/videolib/data` + 详情页 `base_info` 接口补热度 | hot_score |
| 腾讯视频 | trpc.multi_vector_layout.MVLPageHTTPService 列表 + trpc.vector_layout.PageService 详情 | hot_num |
| 优酷 | `list.youku.com` SSR 多分类聚合 + 详情页 `<span class="new-title-heat">` | heat |
| B 站国创 | `api.bilibili.com/pgc/season/index/result` (st=4) + `pgc/view/web/season` 详情 | 播放量 |
| B 站番剧 | 同上 (st=1) | 播放量 |

## 字段维度

- 排名 / 作品名 / 平台热度值或播放量 / 评分
- 完结状态 / 更新进度 / 集数
- 题材标签 / 首播年份 / 首播日期 / 地区
- 内容简介 / 追番人数（B站）/ IP 来源（漫画改/小说改/原创）
- 平台独家标记（独播）/ 排名变化（new/↑↓）

## 部署

GitHub Actions 每日 UTC 00:00（北京 08:00）自动跑：

- `daily-scrape.yml`：跑爬虫 → push → 部署 GitHub Pages
- `deploy.yml`：监听 main push，秒级重新部署（前端改动用）

## 本地开发

```bash
npm install
npx playwright install chromium

npm run scrape:all   # 抓全平台
npm run serve         # 本地预览 http://localhost:8744
```

## 网页功能

- 5 平台 tab 切换：爱奇艺 / 腾讯视频 / 优酷 / B站国创 / B站番剧
- 每个 tab 支持下载 Excel（16 列字段）
- "热度对标"tab：手动填入历史 IP 在各平台的热度峰值，按平台分 section 排布；榜单页 📊 图标可一键加入对标库（localStorage 持久化）
