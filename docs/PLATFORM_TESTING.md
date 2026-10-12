# Platform validation

HeloScrum runs a local Node server and native dependencies. A passing browser page
alone does not verify terminal input, database recovery, provider authentication,
or an agent workflow on another operating system.

## Results and Support

The [Checks workflow](https://github.com/YokiiDesu/heloscrum/actions/workflows/ci.yml)
records each candidate's macOS, Ubuntu, and Windows results. Use its commit and
artifacts when reporting a pass or failure. The Windows job exercises native ACLs,
ConPTY lifecycle, keyboard input, resizing, and WebSocket transport; two desktop
installer tests apply only to macOS and Linux.

Automated Windows checks do not enable native Windows desktop support. Herdr's
Windows `terminal attach` command is unavailable. Linux desktop and WSL provider
workflows also need interactive verification. See [Installation](INSTALLATION.md).

## Automated checks

```sh
npm ci
npm run test:platform
```

The same command runs on Ubuntu / Node 22, macOS / Node 24, and Windows / Node 24
in [Checks](../.github/workflows/ci.yml). Windows failures are blocking; the job is
not marked `continue-on-error`. Each job uploads its report and logs even when a
check fails. Manual workflow dispatch and `ci/platform-validation-*`
branches can test a candidate before merging it into main.

The runner collects syntax and release checks, the entire Node test suite, and a
real server smoke check. Tests are enumerated in Node, so command-shell globbing
is not required. Two test files run concurrently. Tests use portable temporary
paths and file URL conversion, including checkouts with spaces in their names.

The smoke check starts the real server with an isolated temporary Git project,
checks frontend asset routes and unauthenticated API rejection, saves a setting,
restarts the process, verifies database persistence, and rejects the previous
browser token. It starts no agents and makes no paid model calls. Existing tests
exercise real node-pty input/resizing and terminal transport with fixture TUIs;
those are not authenticated provider sessions.

Evidence is saved under ignored `output/platform-validation/`. On Windows,
terminating a child process does not demonstrate a graceful POSIX signal shutdown;
the restart check still verifies reopening the persisted state.

## Linux in Docker

```sh
npm run test:linux
# Optional alternate architecture:
npm run test:linux -- --platform linux/amd64
```

Docker must already be installed and running. The default architecture matches
Apple silicon / ARM64 or x86-64. CPU emulation is not a performance benchmark.

[Dockerfile.test](../Dockerfile.test) pins an official Node 24 / Debian image by
its multi-architecture digest and installs dependencies from the lockfile. It uses
a non-root account. The build context allowlist excludes Git history, dependencies,
workspace data, environment files, PEM/key files, and verification outputs. Only
build-time dependency installation requires network access.

The test container has two CPUs, 3 GiB of memory, a 256-process limit, and no
network. No home directory, project directory, Docker socket, or provider
credentials are mounted. Results are copied to ignored
`output/docker-linux-arm64/` or `output/docker-linux-amd64/`, then that specific
container is removed. The reusable image remains cached; unrelated containers
are not stopped or pruned.

## What these results establish

Record the exact revision, operating system, architecture, Node version, check
results, and limitations. A configured CI job is not a passing result. Keep
Windows ACL/path/executable issues visible rather than skipping them to make
Unix-oriented tests green.

The automated suite does not establish provider login, native trust/permission
menus, authenticated builder/reviewer work, OS credential storage, or interactive
desktop browser behavior. Those still require the small disposable project flow
in [Getting Started](GETTING_STARTED.md) on each target OS. Running Linux in WSL
would verify the WSL/Linux route, not native Windows operation.

## Authenticated Provider Workflow

Use a fresh data root and a disposable Git repository on each target platform.
Keep test credentials and transcripts outside the source repository.

1. Run the documented installer and open the desktop app. Select the disposable
   folder through the native folder chooser and initialize it if needed.
2. Authenticate a builder and a separate reviewer with their provider's normal
   sign-in flow. Confirm their displayed provider and model settings.
3. Give the builder a small change with clear expected behavior and tests. Let
   normal trust and permission prompts appear, and respond through the app.
4. Have the builder commit the change and attach its test results to the task.
   Confirm the attachment opens in the viewer and the task enters review.
5. Have the reviewer inspect that exact commit, run the tests independently, and
   report a verdict with evidence. A builder's own test output is not independent review.
6. Restart HeloScrum. Verify projects, work status, conversations, attachments,
   notebook entries, and provider identities. Send a fresh prompt and confirm a
   real response; restored records alone do not verify resumed delivery.
7. Stop the test agents and desktop deliberately. Record the application commit,
   OS, provider versions, outcomes, and any blocked or unrun checks.

See [Getting Started](GETTING_STARTED.md#4-give-a-small-task-to-a-builder-and-reviewer)
for a sample task. Do not put real credentials or private project data in published
release evidence.
