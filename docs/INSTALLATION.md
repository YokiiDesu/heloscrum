# Installation by OS

HeloScrum runs locally. The Electron app starts a local Node server and the
required Herdr engine; the browser interface can use that same server. You also
need an authenticated provider CLI or a configured model endpoint to run agents.
Opening the app and running Doctor do not send AI requests.

The source is public at [YokiiDesu/heloscrum](https://github.com/YokiiDesu/heloscrum).
A public HTTPS clone does not need a GitHub token. Existing private projects still
use your configured Git credentials; keep tokens out of setup prompts.

## What Setup Installs

`scripts/setup-desktop.sh` detects `Darwin` or `Linux` with `uname`, then selects
the ARM64 or x64 downloads. WSL reports Linux. The same script handles macOS and
Linux; running it in Git Bash does not make native Windows supported.

| Dependency | How It's Provided |
| --- | --- |
| Git 2.28+ | Install beforehand, or accept the installer's platform-specific offer. |
| Node.js 22.13+ and npm | Reuse a compatible installation, or install the pinned private Node 24 runtime. |
| Herdr 0.9.0+ | Required by desktop setup. Reuse a compatible installation, or install the verified 0.9.0 binary. |
| Application and Electron packages | `npm ci` using the two checked-in lockfiles. |
| Provider CLI | Reuse one, optionally install Codex/Claude Code, or configure it later. Sign in separately. |
| Docker, Jev, summary model | Optional; not needed to install or open the app. |

Setup shows its detected platform, seven progress stages, downloads, command
output, questions, and log path. It does not modify your shell profile. Run it
as your normal user. On Linux, only explicitly accepted system-package commands
use `sudo`.

## macOS

Use an Apple Silicon or Intel Mac with a graphical desktop and internet access.
Open Terminal. If Git 2.28+ isn't installed, run `xcode-select --install`, complete
Apple's Command Line Tools installation, then continue.

```sh
git clone https://github.com/YokiiDesu/heloscrum.git
cd heloscrum
bash scripts/setup-desktop.sh
```

Answer the setup questions, complete your provider's login flow, and open the
generated **HeloScrum** launcher. The default runtime/configuration location is
`~/Library/Application Support/HeloScrum/`. This is a source-based desktop installation,
not a signed standalone `.dmg` installer.

## Linux

Use ARM64 or x64 Linux with Bash, Git 2.28+, `curl`, `tar`, and `sha256sum` or `shasum`.
Electron also needs a graphical X11/Wayland session and GTK, NSS, GBM, XSS and
ALSA libraries. Setup can offer packages for apt-based and dnf-based systems.
Other distributions need their equivalent packages installed manually.

```sh
git clone https://github.com/YokiiDesu/heloscrum.git
cd heloscrum
bash scripts/setup-desktop.sh
```

If npm must compile a native module, install Python 3 and a C++ build toolchain
(`build-essential` on Debian/Ubuntu, or `gcc-c++` and `make` on Fedora). Follow
the actual build error rather than changing the Electron sandbox settings.

Setup offers a desktop-menu launcher and stores runtime/configuration under
`${XDG_DATA_HOME:-~/.local/share}/heloscrum/`. Linux's automated suite and
server/restart checks pass. Native desktop and authenticated provider use remain
experimental; Docker server tests don't validate a graphical desktop.

## Windows With WSL 2

The current installation route is **Linux inside WSL 2**, not a native Windows
desktop release. For an Electron window, you need WSLg's Linux GUI support.
This route still needs a complete authenticated desktop check.

1. Follow Microsoft's [WSL installation instructions](https://learn.microsoft.com/windows/wsl/install).
   A new installation normally starts with `wsl --install -d Ubuntu` in an
   administrator PowerShell window. Restart if requested, then finish Ubuntu's
   first-run user setup.
2. Open **Ubuntu**, install its prerequisites, and clone under your Linux home
   directory. Keep active worktrees there rather than in `/mnt/c`.

```sh
sudo apt update
sudo apt install git curl ca-certificates tar
mkdir -p ~/src
cd ~/src
git clone https://github.com/YokiiDesu/heloscrum.git
cd heloscrum
bash scripts/setup-desktop.sh
```

3. Install and sign in to your provider **inside WSL**. A Windows CLI login is
   not automatically a Linux CLI login. Setup detects Linux and uses its normal
   Linux runtime and Herdr downloads.
4. Launch from Ubuntu. If GUI support is unavailable, use the browser setup
   below instead. See Microsoft's [Linux GUI guidance](https://learn.microsoft.com/windows/wsl/tutorials/gui-apps).

### Native Windows Status

Native Windows CI exercises Node, filesystem paths, private-file ACLs, terminals,
and server restart. That is separate from a working desktop installation.
Herdr's Windows implementation does not yet support `herdr terminal attach`, which
HeloScrum uses for embedded native-provider terminals. There is no native
PowerShell desktop installer while that integration remains incomplete.

Contributors can install Node.js 22.13+ and Git 2.28+ for Windows, then run these
checks in PowerShell:

```powershell
git clone https://github.com/YokiiDesu/heloscrum.git
Set-Location heloscrum
npm ci
npm run test:platform
```

If a native package needs compiling, its build requires Python and Microsoft's
C++ build tools. These contributor checks don't enable the blocked desktop
launcher. Current evidence and remaining work are in [Platform Testing](PLATFORM_TESTING.md)
and [Herdr's Windows support notes](https://herdr.dev/docs/windows-beta/).

## Browser Setup

With Node.js 22.13+, npm, Git 2.28+, Herdr, and your provider installed:

```sh
npm ci
npm run doctor -- --provider codex
npm start
```

Replace `codex` with your provider. Open `http://127.0.0.1:4173` and keep the
terminal running. For a different port, use `PORT=4174 npm start` in Bash, or
`$env:PORT=4174; npm start` in PowerShell. Native Windows remains contributor-only.
Provider and Herdr download links are in [Getting Started](GETTING_STARTED.md).

The browser cannot open an unrestricted native directory chooser. Enter a local
path in Projects there; the Electron app provides **Open Local Folder** and
**Browse…** with the OS folder chooser.

## Finish Setup

Open **Projects → Open Local Folder**, choose a repository, and take the **Tour**.
For a folder without Git, **Initialize Git & Open** creates an empty initial
commit. Your existing files stay untracked; nothing is uploaded.

Follow the [first-task walkthrough](GETTING_STARTED.md), or give your coding
agent the [AI setup guide](AI_SETUP.md). Use a disposable project for the first
builder/reviewer task. Agent turns use your selected account's allowance or model
endpoint; Doctor and the automated platform suite use no paid provider turns.

If setup fails, read its last error and log path, fix that prerequisite, and
rerun the same command. `--help` lists options. `--no-launch` installs without
opening a window, and `--repair` reinstalls dependencies while retaining your
workspace. Keep the checkout in place because generated launchers use it.
