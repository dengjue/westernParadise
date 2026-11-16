#!/usr/bin/env python3
"""
生成宣传片封面（1080×1440，3:4，小红书/抖音通用）。

v0.3：封面副标题直接点明「邀请共建」这个唯一目的，避免看成纯情绪片。

画面取自已复核干净的莲池俯瞰帧，叠加宣纸底、标题与协作信息。
不引用任何外部图片素材，字体使用系统内置中文字体。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / ".render" / "frames" / "a_0150.jpg"
# assets/ 那份是入库交付源；dist/ 只是与两支视频放一起的本地预览副本（被 gitignore）。
OUT = ROOT / "assets" / "封面-数字庭院.png"
LOCAL_COPY = ROOT / "dist" / "封面-数字庭院.png"
W, H = 1080, 1440
SONG = "/System/Library/Fonts/Supplemental/Songti.ttc"
HEI = "/System/Library/Fonts/Hiragino Sans GB.ttc"

PAPER = (245, 242, 234)
PAPER_2 = (232, 228, 217)
INK = (46, 50, 47)
MOSS = (76, 107, 82)


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size, index=0)
    except OSError:
        return ImageFont.load_default()


def make_background() -> Image.Image:
    """竖向宣纸渐变，逐行插值，避免外部渐变素材。"""
    img = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(img)
    for y in range(H):
        u = y / H
        color = tuple(round(PAPER[i] + (PAPER_2[i] - PAPER[i]) * u) for i in range(3))
        draw.line([(0, y), (W, y)], fill=color)
    return img


def rounded_clip(src: Image.Image, size: tuple[int, int], radius: int) -> Image.Image:
    """把录屏帧缩放、圆角化，并在左侧做渐隐，形成「从纸里浮出」的效果。"""
    w, h = size
    img = src.convert("RGB").resize((w, h), Image.LANCZOS)
    # 左侧渐隐
    overlay = Image.new("RGB", (w, h), PAPER)
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    for x in range(int(w * 0.22)):
        alpha = int(200 * (1 - x / (w * 0.22)))
        md.line([(x, 0), (x, h)], fill=alpha)
    img = Image.composite(overlay, img, mask)
    # 顶部雾
    fog = Image.new("RGB", (w, h), PAPER)
    fmask = Image.new("L", (w, h), 0)
    fd = ImageDraw.Draw(fmask)
    for y in range(int(h * 0.35)):
        fd.line([(0, y), (w, y)], fill=int(120 * (1 - y / (h * 0.35))))
    img = Image.composite(fog, img, fmask)
    # 圆角
    corner = Image.new("L", (w, h), 0)
    ImageDraw.Draw(corner).rounded_rectangle([0, 0, w - 1, h - 1], radius, fill=255)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(img, (0, 0), corner)
    return out


def center_text(draw: ImageDraw.ImageDraw, y: int, text: str, f: ImageFont.FreeTypeFont,
                fill: tuple[int, int, int], spacing: int = 0) -> None:
    """按字符间距逐字绘制，实现标题的字距拉开效果。"""
    widths = [draw.textlength(ch, font=f) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = (W - total) / 2
    for ch, cw in zip(text, widths):
        draw.text((x, y), ch, font=f, fill=fill)
        x += cw + spacing


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bg = make_background()
    draw = ImageDraw.Draw(bg)

    f_title = font(SONG, 76)
    f_sub = font(HEI, 34)
    f_small = font(HEI, 26)
    f_tag = font(HEI, 36)

    center_text(draw, 176, "一座还没建完的园林", f_title, INK, spacing=9)
    draw.line([(420, 296), (660, 296)], fill=(176, 141, 87), width=2)

    if SRC.exists():
        clip = rounded_clip(Image.open(SRC), (920, 575), 24)
        bg.paste(clip, (80, 360), clip)
    draw.rounded_rectangle([80, 360, 1000, 935], 24, outline=(46, 50, 47, 60), width=2)

    center_text(draw, 1036, "邀请你，一起建", f_tag, MOSS, spacing=6)
    center_text(draw, 1124, "GitHub 开源共建 · 评论一句你会什么", f_sub, INK, spacing=2)

    draw.line([(90, 1284), (990, 1284)], fill=(46, 50, 47), width=1)
    center_text(draw, 1312, "数字庭院 · GitHub · 邀请中", f_small, (120, 120, 112), spacing=4)

    bg.save(OUT, "PNG")
    LOCAL_COPY.parent.mkdir(parents=True, exist_ok=True)
    bg.save(LOCAL_COPY, "PNG")
    print(f"wrote {OUT}  {W}x{H}")
    print(f"local preview copy: {LOCAL_COPY}")


if __name__ == "__main__":
    main()
