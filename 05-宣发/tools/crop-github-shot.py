#!/usr/bin/env python3
"""
把 GitHub 真实页面截图裁成 960x600 的成片素材。

截图是浏览器原样实截，未改 DOM、未改任何仓库数据。这里只做三件事：
  1. 按坐标跳过 GitHub 全站黑色导航条；
  2. 等比缩放为 960x600；
  3. 把文件树的「commit message / 时间」两列用宣纸色渐隐覆盖。

第 3 步的原因：仓库真实提交记录里含项目内部代号与中文宗教题名，
按本项目对外发布的收敛口径（01-宣传片脚本与分镜编排.md 第 0 节）不得入镜。
渐隐同时形成「画面右侧化入纸面」的设计语言，与录屏段的左侧渐隐相呼应；
左侧的仓库名、Public、导航、分支、文件夹名全部保留，可复核、可追溯。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "github-raw.png"
OUT = ROOT / "assets" / "github-shot.png"

# 原图为 4x 截图（clip scale 2 × deviceScaleFactor 2），5120x3440。
# y0=280 跳过全站黑色导航条；2816x1760 = 1.6:1，与 960x600 等比。
CROP = (0, 280, 2816, 2040)
SIZE = (960, 600)
PAPER = (245, 242, 234)

# 渐隐区：x 从 20% 起到 26% 完全覆盖；y 从 44% 起到 50% 完全覆盖。
FADE_X0, FADE_X1 = 0.20, 0.26
FADE_Y0, FADE_Y1 = 0.44, 0.50


def paper_mask(width: int, height: int) -> Image.Image:
    """右下区域化入宣纸：二维线性渐隐，边界柔化但不留可辨文字。"""
    mask = Image.new("L", (width, height), 0)
    px = mask.load()
    for y in range(height):
        v = (y / height - FADE_Y0) / (FADE_Y1 - FADE_Y0)
        vy = max(0.0, min(1.0, v))
        if vy <= 0:
            continue
        for x in range(width):
            u = (x / width - FADE_X0) / (FADE_X1 - FADE_X0)
            px[x, y] = int(255 * max(0.0, min(1.0, u)) * vy)
    return mask


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"缺少原始截图：{RAW}")
    img = Image.open(RAW).convert("RGB")
    x0, y0, x1, y1 = CROP
    x1, y1 = min(x1, img.width), min(y1, img.height)
    shot = img.crop((x0, y0, x1, y1)).resize(SIZE, Image.LANCZOS)
    shot = ImageEnhance.Color(shot).enhance(0.92)

    paper = Image.new("RGB", SIZE, PAPER)
    shot = Image.composite(paper, shot, paper_mask(*SIZE))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    shot.save(OUT, "PNG")
    print(f"wrote {OUT}  {SIZE[0]}x{SIZE[1]}  from crop {CROP}")


if __name__ == "__main__":
    main()
