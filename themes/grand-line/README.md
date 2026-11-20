# 伟大航路（grand-line）

海贼王高定主题：新闻纸暖白、草帽朱红、宝藏金与海图青，整套界面做成一张
会动的悬赏令。背景为海贼王报纸壁纸视频（1080p / 30fps / 10s / 无音轨），
封面帧取正中的路飞悬赏令。

## 海贼王元素

- **WANTED 悬赏令报头**：编辑器纸张顶部是 Bangers 字体的 `WANTED` 大字，
  下方 Pirata One 的 `DEAD OR ALIVE` 红字，草帽缎带（朱红 + 旧金）压顶。
- **草帽骷髅旗**：使用 seeklogo 的海贼王草帽海贼团旗帜矢量（版权归
  © Eiichiro Oda / Shueisha / Toei Animation，仅供个人主题使用），
  用作一级标题项目符号、聊天助手头像、登录卡水印；侧栏顶沿为草帽缎带。
- **航海罗盘 / 海图**：原创 compass-rose SVG 作为弹窗水印；编辑器画布铺
  等距斜向虚线航线；分割线是青色虚线航线 + 朱红航点。
- **漫画语言**：Bangers 漫画大字、Pirata One 海盗标题、半调网点、硬位移
  投影、首字下沉、拟声词「ドン!」引用水印、按钮 hover 的放射速度线。
- **印章与账簿**：设置页抬头图标统一盖成墨色悬赏印章；数据表铺半透明
  新闻纸账簿底纹，学习页整列铺稿纸，压在漫画上仍能读清。

## 设计

- **色板**：新闻纸 `#efe4cc` / `#faf4e4`、墨色 `#1b1712`、草帽朱红 `#b02a1c`、
  宝藏金 `#f2c14e`、海图青 `#2e6f8e`。正文对比度 16.2:1，次级文字 11.4:1，
  辅助文字 7.0:1，朱红强调 6.0:1。
- **排版**：界面用无衬线（Noto Sans CJK SC），正文与标题用衬线
  （Noto Serif CJK SC / 思源宋体），日期、编号、状态栏用等宽字体；
  装饰大字用随包分发的 Bangers / Pirata One（离线可用）。
- **组件覆盖**：侧栏、菜单、弹窗、按钮、输入框、编辑器纸张与全部正文元素、
  笔记卡片 / 嵌入卡、聊天、表格笔记、Notebook、数据表、画布、扩展区块、
  便签、登录页与设置页。
- **响应式**：4K / 2K 由界面缩放承接；平板竖屏收起会话与目录侧栏；手机端
  页头纸签与空态悬赏栏收窄，工具栏、数据表、正文表格改为横向滚动，保持
  每一栏都能读清。

## 文件

- `plugin.json`：manifest + 主题规格（颜色、背景视频 / 封面、透明度、字体）
- `theme.css`：全部装饰样式，限定在 `html[data-kiwi-theme="grand-line"]`
- `assets/background.mp4`：1080p 背景视频（5.7MB）
- `assets/background.webp`：视频封面 / 降级背景（502KB）
- `assets/bangers.woff2`、`assets/pirata-one.woff2`：展示字体（latin 子集）
- `assets/jolly-roger.svg`：草帽海贼团旗帜矢量（seeklogo，个人主题使用）
- `assets/compass-rose.svg`：原创航海罗盘矢量
- `assets/preview.webp`：「欢迎使用 Kiwi」笔记页面截图（640×400）

## 使用

打包后从「设置 → 主题 → 导入主题」安装并启用：

```bash
cd grand-line && zip -r ../grand-line-1.0.4.zip .
```

规范见 [Kiwi `docs/THEME_SPEC.md`](https://github.com/LsWGG/Kiwi/blob/main/docs/THEME_SPEC.md)。
