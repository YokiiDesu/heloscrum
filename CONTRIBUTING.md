# Contributing to HeloScrum

Thanks for helping improve HeloScrum. Start with [setup](docs/GETTING_STARTED.md),
then describe the problem and proposed scope in an issue before a large change.
Small fixes can go directly to a pull request.

## Local development

Use Node.js 22.13 or newer (Node 24 is the suggested starting point) and Git.

```sh
npm ci
npm run check
npm test
npm start
```

Tests use temporary repositories, local HTTP servers, and PTYs. They do not start
paid model turns. The browser app is plain ES modules under `dist/`; these are
maintained source files, not a disposable build directory. Backend code is in
`lib/`, CLI/TUI code in `cli/`, and the standalone landing page in `website/`.

Keep changes focused. Preserve existing saves, provider session identity, queued
messages, project boundaries, and reviewed Git operations. Include tests when
changing these behaviors. Run the relevant browser flow when changing the UI;
describe automated and manual checks separately in your PR.

## Before opening a PR

- Run `npm run check` and `npm test`.
- Explain the user-visible change, validation, and remaining limitations.
- Review the diff for private paths, prompts, credentials, and runtime records.
- Use synthetic fixtures instead of real conversations or provider output.
- Run `gitleaks git . --redact` when available. Never paste secrets in issues.

Human and AI-assisted contributions are welcome. You are responsible for reviewing
submitted code and being accurate about what was tested. Contributions are under
the project's Apache-2.0 license. Keep existing third-party notices intact.

For security problems, follow [SECURITY.md](SECURITY.md) rather than a public issue.

## Merging Changes

`main` requires a pull request, resolved review conversations, and passing macOS,
Linux, Windows, and secret-scanning checks. Branches must be up to date before
merging. These requirements apply to administrators too; force pushes and branch
deletion are disabled. Use squash or rebase merging to keep history linear.

A separate approving reviewer is not required while the project has one maintainer.
The maintainer can merge a pull request after its checks pass.
