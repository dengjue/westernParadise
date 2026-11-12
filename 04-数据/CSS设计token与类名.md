# CSS 设计系统（从参考原件提取）

共 23 个 CSS 变量：

- `--alarm`
- `--bone`
- `--bone-dim`
- `--bone-faint`
- `--f-display`
- `--f-label`
- `--f-mono`
- `--gl`
- `--gr`
- `--ink`
- `--ink-2`
- `--line`
- `--plate`
- `--plate-solid`
- `--rust`
- `--sab`
- `--sal`
- `--sar`
- `--sat`
- `--shadow`
- `--signal`
- `--signal-hot`
- `--steel`

## 高频类名（前 40）

| 类名 | 次数 |
|---|---|
| `menu` | 20 |
| `btn` | 14 |
| `h-wm` | 11 |
| `is-touch` | 10 |
| `h-tape` | 9 |
| `h-cross` | 8 |
| `h-hit` | 8 |
| `h-prompt` | 8 |
| `m-actions` | 8 |
| `loc-card` | 8 |
| `h-cm` | 7 |
| `m-legend` | 7 |
| `slider` | 7 |
| `h-relays` | 6 |
| `off` | 6 |
| `h-health` | 6 |
| `h-pips` | 6 |
| `primary` | 6 |
| `h-ammo` | 5 |
| `m-word` | 5 |
| `m-stats` | 5 |
| `seg` | 5 |
| `toggle` | 5 |
| `extract` | 4 |
| `h-obj` | 4 |
| `h-arc` | 4 |
| `h-fl` | 4 |
| `h-hp-bar` | 4 |
| `h-cue` | 4 |
| `h-ammo-n` | 4 |
| `comms` | 4 |
| `m-veil` | 4 |
| `m-bars` | 4 |
| `m-title` | 4 |
| `m-premise` | 4 |
| `col` | 4 |
| `m-card` | 4 |
| `m-h` | 4 |
| `m-rating` | 4 |
| `tab` | 4 |

## CSS 分区注释

- game/ui.css — owned by the Game agent. One deliberate dark look (a game viewport): port-authority signage meets a film title card. Sections: tokens · page + boot · HUD · radio · to
- ---- boot ----
- ===================================================================== HUD
- objective tracker
- wave warning
- crosshair + hit marker
- damage direction
- interaction prompt
- kill feed + transient message
- health (only while hurt)
- world-space objective diamonds
- ===================================================================== radio subtitles
- ===================================================================== touch controls
- touch layout: keep the thumbs' corners clear
- ===================================================================== menus
- title: a reading scrim on the text side only — the scene stays the picture
- ---- title ----
- controls at a glance on the title (wide screens; the Controls button covers the rest)
- ---- cards: paused / dead / debrief ----
- ---- settings / controls panel ----

## 适配能力

- viewport-fit=cover：True
- prefers-reduced-motion：True
- 触控 is-touch：True
