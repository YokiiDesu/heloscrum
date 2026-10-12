# Third-party notices

HeloScrum has its own interface and task model. It does not embed the Herdr,
lazygit, or lazydocker terminal interfaces.

## lazygit — MIT

Copyright (c) 2018 Jesse Duffield.

`lib/patch.mjs` adapts the parsing structure and line-kind classification from
[`pkg/commands/patch/parse.go`](https://github.com/jesseduffield/lazygit/blob/c07f4d381b90419583b7ce04f87379654d983ebc/pkg/commands/patch/parse.go),
revision `c07f4d381b90419583b7ce04f87379654d983ebc` (v0.65.0).

HeloScrum ports it to JavaScript and adds explicit range parsing, line numbers,
partial-staging eligibility checks, and server-validated hunk selection. The Git
execution and stale-review validation are HeloScrum code.

The complete license is in [licenses/lazygit.txt](licenses/lazygit.txt).

## lazydocker — MIT

The original copyright notice is reproduced in [licenses/lazydocker.txt](licenses/lazydocker.txt).

`lib/resource-history.mjs` adapts append/history-expiry/latest-sample behavior from
[`pkg/commands/container_stats.go`](https://github.com/jesseduffield/lazydocker/blob/7e7aadc2071d58031bf2daafca1fbd4093efc23f/pkg/commands/container_stats.go),
revision `7e7aadc2071d58031bf2daafca1fbd4093efc23f` (v0.25.2).

HeloScrum ports that behavior to JavaScript, adds per-container series, bounds the
sample count, and removes disappeared containers. CPU and memory values come from
Docker's own stats command, not the upstream derived CPU formula.

## Herdr — Apache-2.0

Herdr remains a headless local process dependency; its Rust source is not copied
into the HeloScrum source tree. HeloScrum uses its public CLI protocol for persistent
workspaces, agent lifecycle state, output, prompts, and explicit response keys.
Herdr's original TUI and terminal renderer are not used.

The license was verified at revision
`fb5525fc2234a246dfdfc9e0d7ed73c824cbd8a6` and is retained in
[licenses/herdr.txt](licenses/herdr.txt). Official binaries installed under ignored
`.heloscrum/bin` are not redistributed in this repository. A future binary package
must carry all notices required by the exact bundled Herdr distribution and its
dependencies.

## Electron and downloaded runtimes

The desktop installer downloads Electron 44.7.0 from its pinned npm package and
official binary distribution. Electron is MIT-licensed; its installed distribution
retains `LICENSE` and `LICENSES.chromium.html` for Electron and bundled Chromium
components. The separate [desktop lockfile](desktop/package-lock.json) records
dependency versions and integrity values. Node 24.21.0's official archive retains
its own LICENSE and notices. Required Herdr is downloaded directly from its
official 0.9.0 release and is verified before use. These runtime binaries are not
committed to this source repository. A future redistributable package must retain
all notices from the exact bundled versions.

## Adaptation scope

These focused adaptations do not imply that HeloScrum contains the complete
upstream codebases or implements every upstream feature. The original projects'
names identify provenance; HeloScrum is an independent product.
