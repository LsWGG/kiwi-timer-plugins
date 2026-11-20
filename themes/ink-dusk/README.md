# 墨霞（ink-dusk）

高定古风主题：以「墨画夕阳」壁纸为底，宣纸暖白为面，墨色行文，朱砂钤印
点睛，鎏金细线收边；全局宋体衬线排版。

- `plugin.json`：manifest + `theme` 规格（颜色、背景、透明度、字体）
- `theme.css`：装饰样式，全部限定在 `html[data-kiwi-theme="ink-dusk"]`
- `assets/background.webp`：背景图（3840×2160，宣纸与夕照）
- `assets/preview.webp`：主题画廊缩略图（640×400）

## 设计要点

| 层次 | 取色 | 用途 |
| --- | --- | --- |
| 宣纸 | `#fbf6ea` / `#f3ead9` | 面板与画布底色 |
| 墨 | `#1e1a16` ~ `#93856f` | 正文、标题、次要文本 |
| 朱砂 | `#9c3d2e` | 强调色、按钮、引用边、饰线 |
| 鎏金 | `rgb(191 168 127 / …)` | 面板描边与分隔细线 |

- 面板透明度 0.92 + 12px 毛玻璃，保留背景山水的呼吸感。
- 背景暗化 0.12，保证正文在暖色壁纸上的对比度。
- 字体走系统衬线栈（Noto Serif CJK SC / 宋体），不随包分发字体文件。
- 编辑器纸张叠加极淡的宣纸纤维纹理与夕照暖光。

## 打包与安装

```bash
cd ink-dusk && zip -r ../ink-dusk-1.0.0.zip .
```

在「设置 → 主题 → 导入主题」安装并启用；完整规范见
[Kiwi `docs/THEME_SPEC.md`](https://github.com/LsWGG/Kiwi/blob/main/docs/THEME_SPEC.md)。
