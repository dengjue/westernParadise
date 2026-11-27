#!/usr/bin/env python3
"""
宣传片程序化 BGM 生成器。

设计依据：05-宣发/01-宣传片脚本与分镜编排.md 第 7 节。
声音由数学合成，不使用外部音频采样；这不等于完成版权、音乐权利或内容合规判断。
明确不采样人声、唱念、诵经、木鱼、钟磬、法会录音；成品发布仍需单独审核。

输出：assets/bgm.wav —— 60.0s / 44100Hz / 单声道 / 16bit PCM。
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# 配置区：所有可调参数集中在此，逻辑代码不出现魔法数字
# ---------------------------------------------------------------------------

SAMPLE_RATE = 44_100
DURATION = 60.0
OUT_PATH = Path(__file__).resolve().parents[1] / "assets" / "bgm.wav"

# 五声音阶（C 大调宫调式）；这是创作选择，不代表可据此排除宗教文化联想
# 数字为相对 A4=440Hz 的半音数
PENTATONIC = [-9, -7, -5, -2, 0, 3, 5, 7, 10, 12]  # C3 D3 E3 G3 A3 C4 D4 E4 G4 A4 C5
A4 = 440.0

# 每 2 秒一个钢琴单音，索引指向 PENTATONIC；None 表示留白（28s 留一拍）
NOTE_SEQUENCE = [
    4, 6, 5, 3,          # 00-08 起
    4, 7, 6,             # 08-14
    5, 8, 7, 6,          # 14-22（录屏段①）
    None, 4, 5,          # 22-28（28s 留一拍）
    3, 5, 6, 7,          # 28-36 坦白 → 招募
    8, 7, 9, 6,          # 36-44 六类标签
    7, 8, 9, 8,          # 44-52 愿景（全曲最满）
    6, 5, 4,             # 52-58 回落
    0,                    # 58-60 尾音
]

# 情绪曲线：(时间, 相对音量)。线性插值，决定 pad 与整体强度
ENERGY_CURVE = [
    (0.0, 0.30),
    (6.0, 0.38),
    (13.0, 0.52),
    (18.0, 0.68),
    (24.0, 0.55),
    (28.0, 0.34),
    (33.0, 0.58),
    (38.0, 0.72),
    (45.0, 0.86),
    (52.0, 0.92),
    (54.0, 0.62),
    (58.0, 0.30),
    (60.0, 0.10),
]

PAD_CHORD = [-21, -14, -9, -5]  # C2 G2 C3 E3，持续低音垫

PIANO_DECAY = 2.6          # 钢琴单音衰减时间常数（秒）
PIANO_LEVEL = 0.26
PAD_LEVEL = 0.11
NOISE_LEVEL = 0.012        # 纸面/空气底噪
PULSE_LEVEL = 0.05         # 33-45s 轻脉冲
MASTER_PEAK = 0.72         # 输出峰值上限，留出 headroom 给旁白

# ---------------------------------------------------------------------------


def midi_to_hz(semitones_from_a4: float) -> float:
    """把相对 A4 的半音数换算成频率。"""
    return A4 * (2.0 ** (semitones_from_a4 / 12.0))


def envelope_at(t: float) -> float:
    """按情绪曲线做线性插值，返回 0-1 的相对音量。"""
    if t <= ENERGY_CURVE[0][0]:
        return ENERGY_CURVE[0][1]
    for (t0, v0), (t1, v1) in zip(ENERGY_CURVE, ENERGY_CURVE[1:]):
        if t0 <= t <= t1:
            ratio = (t - t0) / (t1 - t0)
            return v0 + (v1 - v0) * ratio
    return ENERGY_CURVE[-1][1]


def piano_note(freq: float, duration: float) -> np.ndarray:
    """
    合成一个极简钢琴单音：基频 + 三个快速衰减泛音 + 轻微失谐，
    用指数包络模拟击弦后的自然衰减。不使用任何采样。
    """
    n = int(SAMPLE_RATE * duration)
    local = np.arange(n, dtype=np.float64) / SAMPLE_RATE
    env = np.exp(-local / PIANO_DECAY)
    # 起音 6ms，避免爆音
    attack = np.clip(local / 0.006, 0.0, 1.0)
    out = np.zeros(n, dtype=np.float64)
    for harmonic, level, decay_scale in ((1, 1.0, 1.0), (2, 0.34, 0.55),
                                         (3, 0.16, 0.38), (4, 0.07, 0.28)):
        h_env = np.exp(-local / (PIANO_DECAY * decay_scale))
        out += level * h_env * np.sin(2 * np.pi * freq * harmonic * local + 0.02 * harmonic)
    # 极轻微失谐制造厚度
    out += 0.09 * np.exp(-local / (PIANO_DECAY * 0.7)) * np.sin(2 * np.pi * freq * 1.002 * local)
    return out * env * attack


def add_at(buffer: np.ndarray, signal: np.ndarray, start_sec: float, level: float) -> None:
    """把一段信号按指定起点叠加进总缓冲，超出结尾的部分截断。"""
    start = int(start_sec * SAMPLE_RATE)
    if start >= len(buffer):
        return
    end = min(start + len(signal), len(buffer))
    buffer[start:end] += signal[: end - start] * level


def build() -> np.ndarray:
    """按层合成：钢琴 / 环境垫 / 空气底噪 / 脉冲，各层独立后再混合。"""
    n = int(SAMPLE_RATE * DURATION)
    t_axis = np.arange(n, dtype=np.float64) / SAMPLE_RATE

    # 1) 钢琴单音层：每 2 秒一个，音量随情绪曲线微调
    piano = np.zeros(n, dtype=np.float64)
    for i, degree in enumerate(NOTE_SEQUENCE):
        start = i * 2.0
        if degree is None or start >= DURATION:
            continue
        freq = midi_to_hz(PENTATONIC[degree])
        note = piano_note(freq, min(3.2, DURATION - start))
        add_at(piano, note, start, 0.72 + 0.28 * envelope_at(start))

    # 2) 环境垫层：情绪曲线只作用于这一层，钢琴保持清晰
    pad = np.zeros(n, dtype=np.float64)
    for semi in PAD_CHORD:
        freq = midi_to_hz(semi)
        lfo = 1.0 + 0.06 * np.sin(2 * np.pi * 0.07 * t_axis + freq)
        pad += 0.25 * lfo * np.sin(2 * np.pi * freq * t_axis)
    pad *= np.interp(t_axis,
                     [p[0] for p in ENERGY_CURVE],
                     [p[1] for p in ENERGY_CURVE])

    # 3) 空气 / 纸面底噪层：固定种子的低通白噪声，保证可复现
    rng = np.random.default_rng(20261116)
    white = rng.standard_normal(n)
    air = np.convolve(white, np.ones(64) / 64.0, mode="same")
    air /= np.max(np.abs(air)) + 1e-9

    # 4) 轻脉冲层：33-45s 推动「一起建」段落
    pulse_layer = np.zeros(n, dtype=np.float64)
    for beat_t in np.arange(33.0, 45.0, 1.7):
        m = int(SAMPLE_RATE * 0.16)
        local = np.arange(m) / SAMPLE_RATE
        pulse = np.exp(-local / 0.045) * np.sin(2 * np.pi * 110.0 * local)
        add_at(pulse_layer, pulse, float(beat_t), envelope_at(float(beat_t)))

    total = (PIANO_LEVEL * piano
             + PAD_LEVEL * pad
             + NOISE_LEVEL * air
             + PULSE_LEVEL * pulse_layer)

    # 13s 换气点：300ms 自然下凹（两端 1.0，中间 0.25）
    gap_start, gap_end = int(13.0 * SAMPLE_RATE), int(13.3 * SAMPLE_RATE)
    u = np.linspace(0.0, 1.0, gap_end - gap_start)
    total[gap_start:gap_end] *= 1.0 - 0.75 * np.sin(np.pi * u)

    # 全局淡入淡出 + 峰值归一化，留出旁白 ducking 余量
    total *= np.clip(t_axis / 1.5, 0.0, 1.0) * np.clip((DURATION - t_axis) / 2.2, 0.0, 1.0)
    peak = float(np.max(np.abs(total)))
    if peak > 0:
        total *= MASTER_PEAK / peak
    return np.clip(total, -1.0, 1.0)


def write_wav(signal: np.ndarray, path: Path) -> None:
    """写 16bit PCM 单声道 WAV。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (signal * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(struct.pack("<%dh" % len(pcm), *pcm))


if __name__ == "__main__":
    audio = build()
    write_wav(audio, OUT_PATH)
    print(f"wrote {OUT_PATH}  {DURATION:.1f}s  {SAMPLE_RATE}Hz  mono  16bit")
