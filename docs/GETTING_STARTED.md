# Your first HeloScrum workspace

HeloScrum has real-agent usage evidence on macOS and passing Linux automated
checks, including a clean Docker installation. Native Linux agent workflows are
not yet validated. Windows's automated suite and server restart now pass, but
the native desktop launcher remains unsupported; see [Platform Testing](PLATFORM_TESTING.md).
Start with a small disposable Git repository and one or two agents. Provider usage is billed by your own account.

For a desktop window with automatic local-server and Herdr startup, run
`bash scripts/setup-desktop.sh` from this checkout. The interactive installer
handles the runtime dependencies and creates a reusable launcher; see
[Desktop setup](DESKTOP.md). The manual browser instructions follow below.

Start with [Installation by OS](INSTALLATION.md) for macOS, Linux, Windows/WSL,
and native Windows contributor prerequisites. The installer detects macOS/Linux
and ARM64/x64 automatically. To get help from a coding agent, use the README's
copyable prompt and [AI setup guide](AI_SETUP.md).

Once the app opens, choose **Tour** for a guided walkthrough. You can skip it,
resume later, or jump straight to a topic. The tour points out the real controls
without starting agents or submitting tasks.

## 1. Install the prerequisites

- Node.js **22.13 or newer**, with npm. Node 24 is a good starting point.
- Git **2.28 or newer**, including your normal `user.name` and `user.email` configuration.
- One supported provider, installed and signed in separately. Follow its own
  setup instructions: [Codex](https://developers.openai.com/codex/cli/),
  [Claude Code](https://code.claude.com/docs/en/setup),
  [Kiro CLI](https://kiro.dev/docs/cli/), or
  [Cursor CLI](https://cursor.com/docs/cli/installation).
- **Herdr 0.9.0** for Codex, Claude Code, Kiro, or interactive Cursor sessions. Headless Cursor and model
  endpoints use HeloScrum's managed runner and do not require Herdr.

Get the matching binary from the [Herdr 0.9.0 release](https://github.com/herdrdev/herdr/releases/tag/v0.9.0).
For example, on an Apple silicon Mac:

```sh
mkdir -p "$HOME/.local/bin"
curl -fL https://github.com/herdrdev/herdr/releases/download/v0.9.0/herdr-macos-aarch64 -o "$HOME/.local/bin/herdr"
chmod +x "$HOME/.local/bin/herdr"
export PATH="$HOME/.local/bin:$PATH"
herdr --version
```

Use `herdr-macos-x86_64` on an Intel Mac. Add `$HOME/.local/bin` to your shell's
PATH for future terminals. The [upstream install guide](https://herdr.dev/docs/install/)
also documents package managers; their newer releases may differ from our tested
0.9.0 version. Desktop setup requires Herdr and offers its verified installation;
the manual browser setup leaves installation to you.

Docker is optional, for the Services view. Jev and a summary model are optional;
the first task does not require either. To use Ollama, llama.cpp, LM Studio,
Bedrock, or SageMaker instead, follow [AI connections](AI_CONNECTIONS.md).

## 2. Install and diagnose

```sh
git clone https://github.com/YokiiDesu/heloscrum.git
cd heloscrum
npm ci
npm run doctor -- --provider codex
```

Replace `codex` with `claude`, `kiro`, `cursor`, or your endpoint provider. Doctor
checks installed binaries and native modules without starting agents or making
AI requests. It does not establish provider login or available quota. A missing
optional provider is a warning; a missing selected provider is a failure.

If native modules fail to install, use a supported Node release and retry
`npm ci`. Building node-pty from source requires Python and a C++ toolchain
(Xcode Command Line Tools on macOS; compiler/build tools on Linux). Check the
installation error before enabling scripts or changing system packages.

## 3. Open the app

```sh
npm start
```

Open **http://127.0.0.1:4173**. Keep this terminal running. If the port is occupied,
use `PORT=4174 npm start` and open that port; do not stop an unfamiliar process.
Use **Start engine** in the footer if it says Agents offline. Install and
sign in to each provider before adding its agent. Trust/login/permission prompts
remain visible in the agent's card and need your response.

Open the project library using the project name or **Cmd/Ctrl+Shift+P** and select
**Open Local Folder**. In the desktop app, this opens your operating system's
folder chooser; **Browse…** lets you choose again. Browser-only sessions provide
an absolute-path field because a browser cannot grant the local server a folder
path through its upload picker.

Choose an existing Git folder, or a folder you want to turn into a project. For
a folder without Git, HeloScrum offers **Initialize Git & Open** after explaining
the change. This creates an empty initial commit, leaves your existing files
untracked, and uploads nothing. Canceling the picker changes nothing. Invalid
paths stay in the form with an explanation; they don't disconnect the workspace.

If you prefer to prepare a disposable repository in Terminal:

```sh
mkdir ../heloscrum-first-task
cd ../heloscrum-first-task
git init -b main
printf '# First task\n' > README.md
git add README.md
git commit -m "Create first-task workspace"
```

The initial commit gives agent worktrees a starting revision.

Use **Native setup** in the agent form to select a provider profile and carry
local configuration into its worktree. See [Native setup](NATIVE_SETUP.md) for
supported profiles, inherited settings, and the native terminal.

## 4. Give a small task to a builder and reviewer

In **Agents**, choose **Add agent**. Create a Builder and a Reviewer using your
preferred available providers. Different providers are supported but not required.
Use a modest effort setting for this introductory task. Set each startup prompt to:

> Introduce yourself in one sentence, then stop. Wait for an assigned active
> HeloScrum task before editing files. Do not send acknowledgment-only messages.

In **Tasks → New task or plan**, select both agents. Choose **Single task**,
**Direct assignment**, Builder as the initial task owner, and **Ask for my review**.
Choose **Adaptive · Kanban** so this small walkthrough does not require opening
a Scrum sprint. Set Reviewer as QA lead and use this brief:

> Build a dependency-free `slugify.mjs` module exporting `slugify(text)` and a
> Node test file. Lowercase ASCII letters, trim whitespace, replace each run of
> whitespace with one hyphen, and remove other punctuation. Preserve existing
> files. Examples: `" Hello World! "` → `"hello-world"`, `"a   b"` → `"a-b"`,
> `"!!!"` → `""`. Define behavior for non-string input. Builder owns implementation
> and tests. Reviewer independently runs the tests and inspects the code; report
> a concrete defect or verification evidence. Work only on the active assigned
> task and finish with one concise handoff. No new dependencies or deployments.

Definition of Done: examples pass, invalid-input behavior is documented and tested,
Reviewer verifies the candidate in Builder's worktree, and you accept the result.
Choose **Review & start**, check the recipients and policy, then **Start work**.

Inspect the transcript, task status, messages, and Changes view. When Builder
reports **Needs Review**, Reviewer can use `work_verify_task`; authors cannot
self-approve. If either agent stalls, send one specific instruction using **Queue**.
**Steer** is provider-dependent and may interrupt; inspect its displayed behavior.

Commit/merge operations remain separate from task verification. Review the diff
and the exact commit/merge preview before accepting code into your main branch.

## Files, input history, and appearance

Use **Attach files** beside an agent's message box, or paste/drop files onto its
composer. Group conversations also accept attachments. Select up to four files
per message: PNG, JPEG, WebP, and GIF images up to 3 MiB each, and other files up
to 10 MiB each. Click an attachment to preview an image or text/code, or download
its original. Files are uploaded to your local HeloScrum backend when attached;
they reach the agent when you submit the message. Editing a queued message
restores its text and files. A failed send keeps the draft.

Native agents retrieve attachments through the HeloScrum toolbox. Image support
and document extraction depend on the selected provider/model and its tools.
Endpoint models need **This model supports image input** enabled in their
connection for image attachments; other binary documents require a native agent
or conversion to supported text/images. See [AI connections](AI_CONNECTIONS.md).

In each agent's message box, **Up/Down** recalls successfully submitted text and
returns to your unfinished draft. History is separate for each agent and project,
stays in this browser, and retains up to 50 entries. Attachments are not recalled.
For multiline drafts, Up/Down normally moves the caret; history begins at the
first/last line. A provider's native TUI keeps its own keyboard behavior.

In **Settings → Appearance & sound**, choose **Dark**, **Light**, or **Use system**.
Optional sound effects have separate click, completion, and attention previews;
they are off by default. These preferences apply to this browser, persist across
reloads, and do not change another user's settings.

## 5. Check persistence and stop deliberately

After the agents are idle, stop the backend with Ctrl+C and run `npm start` again.
The project, task, messages, and review record should return. Closing the browser
does not stop the backend or native agents. From the HeloScrum installation folder,
stop its native engine only when its agents can safely stop:

```sh
HERDR_CONFIG_PATH="$PWD/.heloscrum/herdr/config.toml" herdr --session heloscrum server stop
```

Back up `.heloscrum/` privately. Do not move or delete it to upgrade the app.
For CLI access use `npm run cli -- projects list --json`; for a terminal interface,
use `npm run tui` in a second terminal. See [CLI](CLI.md) and [security](../SECURITY.md).

## Before reporting a problem

Include the release/commit, OS, Node version, provider CLI version, and redacted
doctor output. Describe the step that failed and whether a provider trust prompt
is open. Remove account identifiers and personal paths. Do not upload `.heloscrum/`.
