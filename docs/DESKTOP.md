# HeloScrum Desktop

The desktop app runs the HeloScrum interface in Electron and starts its local Node
server and Herdr engine. Nothing is deployed to a hosting service. Agent requests
still go to the providers or model endpoints you configure.

## Install and open

Download or clone the HeloScrum repository, open Terminal in its folder, and run:

```sh
bash scripts/setup-desktop.sh
```

The script shows seven stages with separators, colored status, visible download
progress, full install output, questions, and a log location. It works with the
Bash 3.2 shipped on macOS. `NO_COLOR=1` disables its colors. Questions read the
terminal, so redirecting standard input cannot accidentally answer them.

Setup checks Git, uses a compatible installed Node (22.13+), or offers a private
Node 24.21.0 installation. It installs the locked application dependencies and
Electron 44.7.0, then verifies **required Herdr**. Missing/older Herdr is installed
as version 0.9.0. Node and Herdr downloads are checked against pinned SHA-256
digests before execution. System Node and shell profiles are left alone.

Choose existing provider tools, install Claude Code or Codex into HeloScrum's own
tools folder, or configure providers later. This does not sign in, create an
agent, or send an AI request. Follow the printed provider login instructions.
Optional provider installs resolve and display their version at installation time;
they are separate upstream software, not part of HeloScrum's pinned runtime.

Select an existing workspace root containing `.heloscrum/`, an existing Git
repository, or a new empty folder. New empty folders get a small starter Git
repository. An occupied folder that is neither a workspace nor a Git repository
is rejected. Existing workspaces must be closed in other HeloScrum servers first.
The app does not take over or terminate another server.

Setup creates **HeloScrum.command** in the data folder and offers a user-level
Applications shortcut. On macOS this is `~/Applications/HeloScrum.app`; on Linux
it is a desktop-menu entry. These launchers use this source checkout, so keep the
checkout in place. They are local source launchers, not signed standalone releases.

## Guided tour

Choose **Tour** in the app toolbar or **Help → Take a Tour** in the desktop menu.
A small invitation also appears the first time the workspace opens. The 18-step
walkthrough covers projects, agent roles, chat approvals, briefs, verification,
conversations, shared context, tools, code review, and settings.

Soft mint, peach, and lilac outlines highlight the relevant controls. Use **Back**,
**Next**, or **Jump to a topic** to move around. **Skip tour** or **Escape** closes
it and remembers your place. You can resume or start over later. Finishing the
tour suppresses the first-visit invitation; it remains available from the toolbar.

The tour changes the visible workspace tab and follows menus you open with tips
for their controls. Offscreen fields scroll into view. The last **Next** in a
window closes it through its normal close action and advances the tour; **Keep
exploring** pauses the tour without closing your work. The tour does not create
agents, submit tasks, or send messages. In Conversations, **New Group** opens the
group walkthrough; creating or opening a group reveals the attachment tips.
Light/dark themes, small screens, and reduced-motion preferences are supported.
Tour progress stays in this browser profile's local storage.

## Open A Local Project

Choose **Projects → Open Local Folder** to open the native folder chooser.
Select a Git repository to open it directly. For a folder without Git, review
the inline explanation and choose **Initialize Git & Open**. The initial commit
contains no existing files; those files stay untracked until you deliberately
add them. HeloScrum does not create a remote or upload your folder.

Use **Browse…** to choose another folder, or enter its absolute path. Canceling
the chooser leaves the current project in place. A missing or inaccessible
folder produces an inline error and keeps the rest of the app connected.

## Where things live

| Item | Default location |
| --- | --- |
| macOS runtime, configuration and logs | `~/Library/Application Support/HeloScrum/` |
| Linux runtime, configuration and logs | `${XDG_DATA_HOME:-~/.local/share}/heloscrum/` |
| Default starter workspace | `workspace/` inside the data folder |
| Tasks, history, worktrees, local credentials | `.heloscrum/` inside the selected workspace |
| Desktop browser preferences | A profile per workspace inside the data folder |
| Source and dependencies | The downloaded/cloned HeloScrum checkout |

The data folder can be changed with `--home` or `HELOSCRUM_DESKTOP_HOME`. Back up
your workspace's `.heloscrum/` privately. Reinstalling dependencies does not remove it.
Logs can include local paths and runtime errors; inspect/redact them before sharing.

## Repeatable and unattended setup

```sh
bash scripts/setup-desktop.sh --yes --no-launch --no-shortcut --provider none
bash scripts/setup-desktop.sh --node local
bash scripts/setup-desktop.sh --repair
npm run desktop -- --root /absolute/path/to/workspace
```

`--yes` uses printed defaults for core setup, including required Herdr. It never
logs in or answers provider permission requests. Use `--provider codex`, `claude`,
or `both` to explicitly request provider installation. `--no-launch` works without
a graphical session. Run `--help` for all options.

Reruns reuse unchanged dependencies for the same lockfile, OS, architecture and
Node version. `--repair` reinstalls them. Only one installer may modify a checkout
at a time. An interrupted setup can be rerun; workspaces are retained.

## Window and server behavior

- Launching the same workspace again focuses its existing window.
- Each workspace has a stable preferred loopback port. If another process owns
  that port, the OS selects a free port; the other process is left alone.
- **Workspace → Open in Browser** opens the current local address.
- Each desktop workspace uses its own persisted Herdr session name. Browser
  launches recognize the same saved session.
- Closing an empty workspace saves it and stops its server. If agent sessions
  exist or their state cannot be checked, a native dialog offers **Keep Running**,
  **Quit HeloScrum**, or **Cancel**. Keep Running minimizes the window.
- Quit stops managed runs and the owned local server. Native provider sessions
  may continue separately: stop those in Agents first when that is your intent.
  An engine started by this desktop is stopped only when it has no agents. An
  engine that was already running is left alone.
- Startup failures stay visible in the window. **Workspace → Show Desktop Log**
  reveals the diagnostic log. A disconnected desktop supervisor also asks its
  child server to close, so a normal crash does not leave a server holding the DB.

## Desktop security and runtime

The renderer has Node integration disabled, context isolation enabled, and the
Chromium sandbox enabled. Its only filesystem-related bridge opens a native
folder chooser and returns the selected path. It accepts requests only from the
app's main frame at its current local origin; it cannot read files or run commands.
A display-only startup bridge accepts status text from the main process. Agent transcripts remain
untrusted content. The existing HTTP session, same-origin rules, CSP and terminal
authentication remain in use. Navigation stays inside the local app; external
HTTP(S) links ask before opening in the system browser. Other URI schemes and
webviews are blocked. OS permission requests are denied except sanitized clipboard
writes from the local app.

The server runs in a **regular Node process** rather than Electron's Node runtime.
This preserves the native-module ABI used by `npm ci` for PTY and DuckDB. Electron
dependencies have their own lockfile under `desktop/`; browser-only installations
do not download Electron. Update the Electron pin and lockfile deliberately as
Chromium security releases arrive. This alpha has no automatic updater.

## Platforms and troubleshooting

macOS is the primary desktop target. Linux's automated server checks pass, but
desktop/provider workflows are experimental. A graphical X11/Wayland session and
Electron's system libraries are required. Native Windows is blocked while the
known terminal/path/permission failures in [Platform testing](PLATFORM_TESTING.md)
are unresolved. A Bash script or Electron shell does not fix those backend issues.

- **Git missing on macOS:** setup offers Apple's Command Line Tools installer.
  Complete it, then rerun setup.
- **Git or build tools missing on Linux:** install Git, Python and your distro's
  C++ build toolchain as instructed by setup. Native prebuilds usually avoid a
  local compilation; check actual npm errors if compilation is attempted.
- **Linux shared libraries missing:** use your distro's Electron/Chromium runtime
  dependencies, including GTK, NSS and ALSA. Never work around a sandbox error
  with `--no-sandbox`; use your distro's supported user-namespace configuration.
- **Runtime moved/deleted:** rerun setup to regenerate the launcher.
- **Workspace already open / database lock:** close its other server deliberately,
  or select a different workspace. Do not delete its database or lock data.
- **Provider not signed in:** run the provider's own login flow. CLI detection is
  not evidence of authentication or quota.

For source details see [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[native Node modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules),
[Herdr installation](https://herdr.dev/docs/install/),
[Claude Code setup](https://code.claude.com/docs/en/setup), and
[Codex CLI setup](https://developers.openai.com/codex/cli/).

## Verification

Run `npm run test:platform` for syntax, release checks, automated tests, and server
restart. The suite includes desktop configuration, runtime isolation, installer,
folder-selection API, and tour behavior tests.

For native desktop and authenticated agent checks, follow
[Platform Testing](PLATFORM_TESTING.md#authenticated-provider-workflow). Test the
folder chooser, permission prompts, attachment viewer, and delivery after restart
on the actual target operating system. See [Release Status](RELEASE_STATUS.md) for
current platform limits and the known Claude Mod restart issue.
