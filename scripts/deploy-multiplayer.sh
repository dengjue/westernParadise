#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

host=qu3
ip=192.168.100.25
origin="http://$ip:5173"
ssh_cmd=(ssh -o BatchMode=yes -o ConnectTimeout=8 "$host")
node_archive=node-v22.23.5-linux-x64.tar.xz
node_sha=cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8
base=.local/share/western-paradise
unit=western-paradise-test.service

if (( $# > 0 )); then
  echo 'Usage: bash scripts/deploy-multiplayer.sh' >&2
  exit 2
fi
test "$("${ssh_cmd[@]}" 'uname -sm')" = "Linux x86_64"
npm run typecheck
npm run check:layers
npm run check:content
npm test
COURTYARD_DEPLOY_ORIGIN="$origin" npm run build:multiplayer

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
if ! "${ssh_cmd[@]}" "test -x $base/runtime/bin/node"; then
  if [[ -n ${NODE_ARCHIVE:-} ]]; then
    cp -- "$NODE_ARCHIVE" "$work/$node_archive"
  else
    curl --fail --silent --show-error --location --max-time 90 \
      "https://nodejs.org/dist/v22.23.5/$node_archive" -o "$work/$node_archive"
  fi
  (cd "$work" && printf '%s  %s\n' "$node_sha" "$node_archive" | sha256sum --check --status)
  runtime_staging=$("${ssh_cmd[@]}" "mkdir -p $base && mktemp -d $base/.runtime.XXXXXXXX")
  [[ "$runtime_staging" =~ ^\.local/share/western-paradise/\.runtime\.[a-zA-Z0-9]+$ ]]
  rsync -a -e 'ssh -o BatchMode=yes -o ConnectTimeout=8' -- \
    "$work/$node_archive" "$host:$runtime_staging/"
  "${ssh_cmd[@]}" "flock $base/runtime.lock bash -s -- '$runtime_staging' '$node_archive' '$node_sha'" <<'RUNTIME'
set -euo pipefail
staging="$HOME/$1"
base="$HOME/.local/share/western-paradise"
trap 'rm -rf -- "$staging"' EXIT
if ! test -x "$base/runtime/bin/node"; then
  cd "$staging"
  printf '%s  %s\n' "$3" "$2" | sha256sum --check --status
  mkdir node
  tar -xJf "$2" -C node --strip-components=1
  test "$(node/bin/node --version)" = v22.23.5
  mv -T node "$base/runtime"
fi
RUNTIME
fi

release=$("${ssh_cmd[@]}" "mkdir -p $base/releases ~/.config/systemd/user && mktemp -d $base/releases/$(git rev-parse --short HEAD).XXXXXXXX")
[[ "$release" =~ ^\.local/share/western-paradise/releases/[0-9a-f]+\.[a-zA-Z0-9]+$ ]]
rsync -a -e 'ssh -o BatchMode=yes -o ConnectTimeout=8' -- dist/multiplayer/ "$host:$release/"

"${ssh_cmd[@]}" "flock $base/deploy.lock bash -s -- '$release' '$ip' '$unit'" <<'REMOTE'
set -euo pipefail
release="$HOME/$1"
ip=$2
unit=$3
base="$HOME/.local/share/western-paradise"
unit_file="$HOME/.config/systemd/user/$unit"
previous=$(readlink "$base/current" || true)
test -x "$base/runtime/bin/node"
test -s "$release/index.html"
test -s "$release/server.mjs"
if [[ ! -e "$unit_file" ]]; then
  cat > "$unit_file" <<EOF
[Unit]
Description=Western Paradise LAN multiplayer test

[Service]
WorkingDirectory=%h/.local/share/western-paradise/current
ExecStart=%h/.local/share/western-paradise/runtime/bin/node server.mjs $ip
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes
UMask=077

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
fi

# 同一文件系统内原子切换。上一版目录保留，失败时切回。
switch_release() {
  ln -s "$1" "$base/.switch-$$"
  mv -Tf "$base/.switch-$$" "$base/current"
}
switch_release "$release"
origin="http://$ip:5173"
healthy() {
  curl --noproxy '*' -fsS --max-time 2 "$origin/" >/dev/null || return 1
  local headers
  headers=$(curl --noproxy '*' --silent --max-time 1 --http1.1 --dump-header - --output /dev/null \
    -H "Origin: $origin" -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    "$origin/multiplayer" || true)
  [[ "$headers" == 'HTTP/1.1 101 '* ]]
}
if systemctl --user restart "$unit"; then
  for attempt in {1..10}; do
    if healthy && systemctl --user enable "$unit"; then
      echo "主体验（单机）：$origin/"
      echo "精修大世界步行与飞行联机：$origin/?cam=third&multiplayer=1"
      echo "早期小庭院联机原型：$origin/?scene=courtyard&multiplayer=1"
      exit 0
    fi
    sleep 1
  done
fi
journalctl --user -u "$unit" -n 15 --no-pager >&2 || true
if [[ -n "$previous" ]]; then
  switch_release "$previous"
  systemctl --user reset-failed "$unit" || true
  systemctl --user restart "$unit"
else
  systemctl --user stop "$unit"
  rm -- "$base/current"
fi
echo '部署检查失败，已恢复之前的状态。' >&2
exit 1
REMOTE
