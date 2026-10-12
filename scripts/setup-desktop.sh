#!/bin/bash
# Bash 3.2-compatible local installer. Run from a downloaded/cloned HeloScrum checkout.
set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
HeloScrum desktop setup
  bash scripts/setup-desktop.sh [options]

  --yes                  Accept core setup defaults without prompting (no provider login)
  --no-launch            Install and verify; do not open the desktop window
  --no-shortcut          Keep the generated launcher without adding an Applications shortcut
  --home PATH            Store runtime, launchers and logs in this absolute directory
  --workspace PATH       Use this Git workspace or a new empty directory
  --node auto|local      Use a compatible installed Node, or install private Node 24
  --provider CHOICE      existing (default), none, codex, claude, both
  --repair              Reinstall locked application and Electron dependencies
  --help                 Show this help

Herdr is required: an existing installation is verified or version 0.9.0 is installed.
Setup never signs in, sends AI prompts, changes shell profiles, or uses sudo npm.
macOS is the primary desktop platform. Linux desktop is experimental; Windows is not ready.
EOF
}

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
platform=$(uname -s)
machine=$(uname -m)
case "$platform" in
  Darwin) setup_home=${HELOSCRUM_DESKTOP_HOME:-"$HOME/Library/Application Support/HeloScrum"}; os_name=darwin; herdr_os=macos ;;
  Linux) setup_home=${HELOSCRUM_DESKTOP_HOME:-"${XDG_DATA_HOME:-$HOME/.local/share}/heloscrum"}; os_name=linux; herdr_os=linux ;;
  *) setup_home=${HELOSCRUM_DESKTOP_HOME:-"$HOME/.local/share/heloscrum"}; os_name=unsupported; herdr_os=unsupported ;;
esac
yes_mode=0; launch=1; shortcut=ask; workspace=''; node_mode=auto; provider=ask; repair=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --yes) yes_mode=1 ;;
    --no-launch) launch=0 ;;
    --no-shortcut) shortcut=no ;;
    --repair) repair=1 ;;
    --home|--workspace|--node|--provider)
      [ "$#" -ge 2 ] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      case "$1" in --home) setup_home=$2;; --workspace) workspace=$2;; --node) node_mode=$2;; --provider) provider=$2;; esac
      shift ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
case "$node_mode" in auto|local) ;; *) printf 'Invalid --node choice\n' >&2; exit 2;; esac
case "$provider" in ask|existing|none|codex|claude|both) ;; *) printf 'Invalid --provider choice\n' >&2; exit 2;; esac
case "$setup_home" in /*) ;; *) printf -- '--home must be an absolute path\n' >&2; exit 2;; esac

# Decide color before tee changes stdout. Prompts always read the terminal, even with piped stdin.
color=0; if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then color=1; fi
reset=''; cyan=''; green=''; amber=''; red=''; bold=''
if [ "$color" -eq 1 ]; then reset=$'\033[0m'; cyan=$'\033[36m'; green=$'\033[32m'; amber=$'\033[33m'; red=$'\033[31m'; bold=$'\033[1m'; fi
line() { printf '\n%s%s%s\n' "$cyan" '────────────────────────────────────────────────────────────' "$reset"; }
say() { printf '  %s\n' "$*"; }
ok() { printf '  %s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '  %s!%s %s\n' "$amber" "$reset" "$*"; }
fail() { printf '\n  %sSetup stopped:%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }
step() { line; printf '  %s[%s/7] %s%s\n\n' "$bold" "$1" "$2" "$reset"; }
answer=''
ask() {
  local prompt=$1 default=$2
  if [ "$yes_mode" -eq 1 ]; then answer=$default; say "$prompt → $default (--yes)"; return; fi
  if ! { true </dev/tty; } 2>/dev/null; then fail 'No interactive terminal. Rerun with --yes and explicit options, or run in Terminal.'; fi
  printf '\n  %s%s [%s]: %s' "$bold" "$prompt" "$default" "$reset"
  if ! IFS= read -r answer </dev/tty; then fail 'No answer received. Rerun when you are ready.'; fi
  answer=${answer:-$default}
}
confirm() {
  while :; do
    ask "$1 (yes/no)" "$2"
    case "$answer" in y|Y|yes|YES) return 0;; n|N|no|NO) return 1;; *) warn 'Please answer yes or no.';; esac
  done
}

mkdir -p "$setup_home/logs"
setup_log="$setup_home/logs/setup-$(date '+%Y%m%d-%H%M%S')-$$.log"
exec > >(tee -a "$setup_log") 2>&1
temp_dir=''; locked=0
cleanup() {
  if [ -n "$temp_dir" ]; then rm -rf -- "$temp_dir"; fi
  if [ "$locked" -eq 1 ]; then rm -f -- "$repo_dir/.desktop-setup.lock/pid"; rmdir "$repo_dir/.desktop-setup.lock" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'printf "\n  Setup interrupted. Completed downloads and your workspace are kept.\n  Run the same command to continue.\n"; exit 130' INT TERM
trap 'result=$?; printf "\n  %sStep failed (line %s, exit %s).%s\n  Review the error above. Log: %s\n  Correct it and rerun the same setup command.\n" "$red" "$LINENO" "$result" "$reset" "$setup_log" >&2; exit "$result"' ERR

line
printf '  %sHELOSCRUM%s  /  Desktop Setup\n' "$bold" "$reset"
say 'Your agents. Your workspace. Running on your computer.'
say "Install log: $setup_log"
say 'Downloads and command output remain visible throughout setup.'

step 1 'Check this computer'
[ "$os_name" != unsupported ] || fail 'Native Windows desktop setup is not available. Open Ubuntu in WSL 2 and run this script there, or see docs/INSTALLATION.md for contributor checks. Git Bash is not WSL.'
[ "$(id -u)" -ne 0 ] || fail 'Run as your normal desktop user, not root.'
case "$machine" in arm64|aarch64) node_arch=arm64; herdr_arch=aarch64;; x86_64|amd64) node_arch=x64; herdr_arch=x86_64;; *) fail "Unsupported architecture: $machine";; esac
ok "$platform / $machine"
if [ "$platform" = Linux ]; then warn 'Linux desktop is experimental. Server tests pass; native desktop/provider workflows need wider testing.'; fi
for command_name in curl tar; do command -v "$command_name" >/dev/null || fail "Install $command_name with your system package manager and rerun setup."; done
install_linux_system_packages() {
  local reason=$1 alsa=libasound2 gtk=libgtk-3-0
  say "$reason"
  if command -v apt-get >/dev/null; then
    if apt-cache show libasound2t64 >/dev/null 2>&1; then alsa=libasound2t64; fi
    if apt-cache show libgtk-3-0t64 >/dev/null 2>&1; then gtk=libgtk-3-0t64; fi
    say "System packages: git python3 build-essential $gtk libnss3 libxss1 libgbm1 $alsa"
    confirm 'Install these system packages with sudo apt-get?' no || return 1
    sudo apt-get update
    sudo apt-get install -y git python3 build-essential "$gtk" libnss3 libxss1 libgbm1 "$alsa"
  elif command -v dnf >/dev/null; then
    say 'System packages: git python3 gcc-c++ make gtk3 nss libXScrnSaver mesa-libgbm alsa-lib'
    confirm 'Install these system packages with sudo dnf?' no || return 1
    sudo dnf install -y git python3 gcc-c++ make gtk3 nss libXScrnSaver mesa-libgbm alsa-lib
  else
    warn 'Install Git, Python, a C++ build toolchain, GTK, NSS, GBM, XSS and ALSA with your distro package manager.'
    return 1
  fi
}
if ! git --version; then
  if [ "$platform" = Darwin ]; then
    if confirm 'Open the Apple Command Line Tools installer for Git?' yes; then xcode-select --install || true; fi
    fail 'Finish installing Command Line Tools, then rerun setup.'
  fi
  install_linux_system_packages 'Git is required. Setup can install Git and desktop prerequisites.' || fail 'Install Git using your package manager and rerun setup.'
  git --version
fi
ok 'Git is available'
if ! mkdir "$repo_dir/.desktop-setup.lock" 2>/dev/null; then
  old_pid=$(cat "$repo_dir/.desktop-setup.lock/pid" 2>/dev/null || true)
  case "$old_pid" in ''|*[!0-9]*) fail 'Another setup owns .desktop-setup.lock. Check it before retrying.';; esac
  if kill -0 "$old_pid" 2>/dev/null; then fail "Setup is already running (PID $old_pid)."; fi
  rm -f "$repo_dir/.desktop-setup.lock/pid"; rmdir "$repo_dir/.desktop-setup.lock"; mkdir "$repo_dir/.desktop-setup.lock"
fi
printf '%s\n' "$$" > "$repo_dir/.desktop-setup.lock/pid"; locked=1
temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/heloscrum-setup.XXXXXX")
download() {
  local url=$1 file=$2
  say "Downloading $(basename "$file")"
  curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 20 --progress-bar "$url" -o "$file"
}
verify() {
  local expected=$1 file=$2 actual
  if command -v shasum >/dev/null; then actual=$(shasum -a 256 "$file" | cut -d ' ' -f 1)
  elif command -v sha256sum >/dev/null; then actual=$(sha256sum "$file" | cut -d ' ' -f 1)
  else fail 'Install shasum or sha256sum to verify downloaded files.'; fi
  [ "$actual" = "$expected" ] || fail "Checksum mismatch for $(basename "$file"). The downloaded file will not be used."
  ok "Verified SHA-256: $(basename "$file")"
}

step 2 'Prepare Node.js'
node_bin=''
if [ "$node_mode" = auto ] && command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||a===22&&b>=13?0:1)' 2>/dev/null; then
  node_bin=$(node -p process.execPath)
fi
if [ -z "$node_bin" ]; then
  say 'HeloScrum needs Node 22.13 or newer. A private Node 24 runtime will leave your system Node untouched.'
  confirm 'Install verified Node 24.21.0 in the HeloScrum data folder?' yes || fail 'Node is required. Install it yourself, then rerun setup.'
  runtime_name="node-v24.21.0-$os_name-$node_arch"
  case "$os_name-$node_arch" in
    darwin-arm64) node_sha=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057;;
    darwin-x64) node_sha=1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097;;
    linux-arm64) node_sha=724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5;;
    linux-x64) node_sha=6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff;;
  esac
  node_bin="$setup_home/runtime/$runtime_name/bin/node"
  if [ ! -x "$node_bin" ]; then
    download "https://nodejs.org/dist/v24.21.0/$runtime_name.tar.gz" "$temp_dir/$runtime_name.tar.gz"
    verify "$node_sha" "$temp_dir/$runtime_name.tar.gz"
    tar -xzf "$temp_dir/$runtime_name.tar.gz" -C "$temp_dir"
    mkdir -p "$setup_home/runtime"
    mv "$temp_dir/$runtime_name" "$setup_home/runtime/"
  fi
fi
export PATH="$(dirname "$node_bin"):$setup_home/bin:$setup_home/tools/bin:$HOME/.local/bin:$PATH"
command -v npm >/dev/null || fail 'npm is missing. Rerun with --node local to install Node and npm together.'
ok "Node $("$node_bin" --version) · npm $(npm --version)"

step 3 'Install HeloScrum and Electron'
say 'Installing locked dependencies. Native modules may take a few minutes on first install.'
mkdir -p "$setup_home/installed"
install_packages() {
  local name=$1 directory=$2 fingerprint stamp
  fingerprint=$("$node_bin" "$repo_dir/scripts/desktop-setup.mjs" fingerprint "$setup_home" "$name")
  stamp="$setup_home/installed/$name.sha256"
  if [ "$repair" -eq 0 ] && [ -d "$directory/node_modules" ] && [ "$(cat "$stamp" 2>/dev/null || true)" = "$fingerprint" ]; then
    ok "$name dependencies already match this lockfile and Node runtime"
  else
    (cd "$directory" && npm ci --no-fund --no-audit --foreground-scripts)
    printf '%s\n' "$fingerprint" > "$stamp"
  fi
}
install_packages app "$repo_dir"
install_packages desktop "$repo_dir/desktop"
if ! "$node_bin" "$repo_dir/scripts/desktop-setup.mjs" electron-check; then
  say 'Completing the pinned Electron download (some npm versions defer this step).'
  "$node_bin" "$repo_dir/desktop/node_modules/electron/install.js"
  "$node_bin" "$repo_dir/scripts/desktop-setup.mjs" electron-check
fi
ok 'Application dependencies and Electron are installed'
if [ "$platform" = Linux ] && command -v ldd >/dev/null; then
  electron_bin=$("$node_bin" -p "require(process.argv[1])" "$repo_dir/desktop/node_modules/electron")
  missing_libraries=$(ldd "$electron_bin" 2>&1 | sed -n '/not found/p')
  if [ -n "$missing_libraries" ]; then
    warn "$missing_libraries"
    install_linux_system_packages 'Electron needs additional shared libraries.' || fail 'Install the listed desktop libraries, then rerun setup.'
    [ -z "$(ldd "$electron_bin" 2>&1 | sed -n '/not found/p')" ] || fail 'Some Electron libraries are still missing; inspect ldd output and your distro packages.'
  fi
fi

step 4 'Verify the Herdr agent engine'
herdr_bin=$(command -v herdr || true)
herdr_version=''
if [ -n "$herdr_bin" ]; then herdr_version=$("$herdr_bin" --version 2>/dev/null || true); fi
if [ -n "$herdr_version" ] && "$node_bin" -e 'const m=process.argv[1].match(/(\d+)\.(\d+)\.(\d+)/);process.exit(m&&(Number(m[1])>0||Number(m[2])>=9)?0:1)' "$herdr_version"; then
  say "$herdr_version"
  ok "Using existing Herdr: $herdr_bin"
else
  say 'Herdr connects HeloScrum to native coding-agent sessions and is required for desktop setup.'
  confirm 'Install verified Herdr 0.9.0 locally?' yes || fail 'Herdr is required. Install it yourself, then rerun setup.'
  case "$herdr_os-$herdr_arch" in
    macos-aarch64) herdr_sha=32b53df09872628059c789a69f02a6b8e29e14ddf26711421f3463f70c1aef17;;
    macos-x86_64) herdr_sha=d0c920b2a126a74809fa1491411c9a097a44786cac9c2ca51b818a995581cf16;;
    linux-aarch64) herdr_sha=9c8db20fb7e7427b138d5367113f1621ffd319f2f65d6f009e2594029115f0d2;;
    linux-x86_64) herdr_sha=4fa1a01158dd8043da92d31b270780b0dcc10603038d9b61cac4d81ab63fb71f;;
  esac
  download "https://github.com/herdrdev/herdr/releases/download/v0.9.0/herdr-$herdr_os-$herdr_arch" "$temp_dir/herdr"
  verify "$herdr_sha" "$temp_dir/herdr"
  chmod 755 "$temp_dir/herdr"
  "$temp_dir/herdr" --version
  mkdir -p "$setup_home/bin"
  mv "$temp_dir/herdr" "$setup_home/bin/herdr"
  ok 'Herdr installed'
fi

step 5 'Choose provider tools'
say 'Provider accounts and usage belong to you. Setup does not log in or send AI requests.'
for provider_name in codex claude kiro-cli cursor-agent; do
  if command -v "$provider_name" >/dev/null; then ok "Found $provider_name"; else say "$provider_name — not detected"; fi
done
if [ "$provider" = ask ]; then
  say 'existing = keep your tools · codex · claude · both · none = configure later'
  while :; do ask 'Which provider tools should setup install?' existing; case "$answer" in existing|none|codex|claude|both) provider=$answer; break;; *) warn 'Choose existing, none, codex, claude, or both.';; esac; done
fi
install_provider() {
  local name=$1 package_name=$2 version
  if command -v "$name" >/dev/null; then ok "$name is already installed; leaving it unchanged"; return; fi
  version=$(npm view "$package_name" version)
  say "Installing $package_name@$version in $setup_home/tools (no sudo)."
  npm install --global --prefix "$setup_home/tools" "$package_name@$version" --no-audit --no-fund --foreground-scripts
  "$setup_home/tools/bin/$name" --version
}
case "$provider" in codex) install_provider codex @openai/codex;; claude) install_provider claude @anthropic-ai/claude-code;; both) install_provider codex @openai/codex; install_provider claude @anthropic-ai/claude-code;; esac
say 'To sign in later, run your provider CLI: codex login · claude auth login'
say 'Kiro: https://kiro.dev/docs/cli/ · Cursor: https://cursor.com/docs/cli/installation'

step 6 'Choose your workspace and create a launcher'
saved_root=$("$node_bin" "$repo_dir/scripts/desktop-setup.mjs" saved-root "$setup_home")
if [ -z "$workspace" ]; then
  say 'Use a new folder for a fresh workspace, or the root containing an existing .heloscrum folder.'
  say 'Keep an existing workspace closed in other HeloScrum servers while opening it here.'
  ask 'Workspace folder (absolute path)' "${saved_root:-$setup_home/workspace}"
  workspace=$answer
fi
case "$workspace" in /*) ;; *) fail 'Workspace must be an absolute path.';; esac
if [ "$shortcut" = ask ]; then
  if confirm 'Add HeloScrum to your user Applications menu?' yes; then shortcut=yes; else shortcut=no; fi
fi
"$node_bin" "$repo_dir/scripts/desktop-setup.mjs" configure "$setup_home" "$workspace" "$shortcut"
export HELOSCRUM_ROOT="$workspace"
"$node_bin" "$repo_dir/scripts/doctor.mjs"
ok 'Core diagnostics passed'

step 7 'Open HeloScrum'
say "Workspace: $workspace"
say "Next launch: $setup_home/HeloScrum.command"
say 'Your app starts a loopback-only server automatically; no hosting or port forwarding is needed.'
say 'The desktop app connects Herdr automatically. Choose a signed-in provider when adding an agent.'
if [ "$launch" -eq 0 ]; then ok 'Setup complete. Launch skipped (--no-launch).'; exit 0; fi
if [ "$platform" = Linux ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  warn 'No graphical desktop detected. Setup is complete; open the launcher from your desktop session.'
  exit 0
fi
if ! confirm 'Launch the desktop app now?' yes; then ok 'Setup complete. Your launcher is ready.'; exit 0; fi
ok 'Opening the desktop window. Startup and server messages follow.'
cleanup; temp_dir=''; locked=0
export HELOSCRUM_DESKTOP_HOME="$setup_home"
"$node_bin" "$repo_dir/scripts/desktop.mjs"
ok 'Desktop app closed'
