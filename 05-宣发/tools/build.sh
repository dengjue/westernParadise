#!/usr/bin/env bash
# 宣传片一键复跑：原始录屏 -> 干净切片 -> 帧序列 -> GitHub 实截 -> BGM -> 封面 -> MP4
#
# 前提：
#   1. 源录屏位于 ~/Downloads/录屏2026-11-16 11.36.45.mov
#   2. 已安装 ffmpeg、Node 22+、Python 3 + numpy + Pillow
#   3. macOS + /Applications/Google Chrome.app
#
# 注意：切片必须用「从头解码 + trim」而不是输入侧 -ss。
# 源片时间戳不连续，快速 seek 会偏移到完全不同的镜头（实测偏移可达数十秒）。

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HOME/Downloads/录屏2026-11-16 11.36.45.mov"
cd "$ROOT"

mkdir -p assets .render/frames dist

echo "[1/7] 段① 莲池俯瞰：源 60-70s，下半部裁切避开殿内造像"
ffmpeg -y -v error -t 70 -i "$SRC" \
  -vf "fps=30,crop=1296:810:200:950,scale=960:600,trim=start=60:end=70,setpts=PTS-STARTPTS,eq=saturation=0.94" \
  -an -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p assets/clip-a.mp4

echo "[2/7] 段② 长廊近景：源 36-41s，慢放 2 倍到 10s"
ffmpeg -y -v error -t 41 -i "$SRC" \
  -vf "fps=30,crop=2528:1580:200:160,scale=960:600,trim=start=36:end=41,setpts=2*(PTS-STARTPTS),fps=30,eq=saturation=0.90" \
  -an -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p assets/clip-b.mp4

echo "[3/7] 抽出逐帧序列（渲染用，保证确定性）"
ffmpeg -y -v error -i assets/clip-a.mp4 -fps_mode passthrough -q:v 4 .render/frames/a_%04d.jpg
ffmpeg -y -v error -i assets/clip-b.mp4 -fps_mode passthrough -q:v 4 .render/frames/b_%04d.jpg

echo "[4/7] GitHub 仓库页实截（已有素材则跳过；需要可访问 github.com）"
if [ ! -f assets/github-shot.png ]; then
  node tools/make-github-shot.mjs
else
  echo "  复用 assets/github-shot.png；如需重截请删除该文件后重跑"
fi

echo "[5/7] 程序化 BGM"
python3 tools/make-bgm.py

echo "[6/7] 封面"
python3 tools/make-cover.py

echo "[7/7] 逐帧导出 60s 母版 + 30s 抖音版（全量重渲）"
node tools/render.mjs --force

echo "完成：视频在 dist/（不入库），封面与素材在 assets/（入库）"
