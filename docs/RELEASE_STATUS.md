# Release Status

HeloScrum is free, open-source software distributed as a source-based release. The
[repository](https://github.com/YokiiDesu/heloscrum) and
[website](https://yokiidesu.github.io/heloscrum/) are available now.

## Platform Support

| Platform | Status |
| --- | --- |
| macOS | Primary desktop target. Install with the documented Bash setup script. |
| Linux | Automated checks run on Ubuntu; native desktop and authenticated provider workflows need interactive verification. |
| Windows with WSL | Experimental route; verify the full desktop and provider workflow in the target WSL environment. |
| Native Windows | Automated tests run on Windows. Desktop support is blocked by the missing Herdr terminal-attach capability. |

Use the [current Checks workflow](https://github.com/YokiiDesu/heloscrum/actions/workflows/ci.yml)
to inspect the result for a particular commit. Automated tests cover API boundaries,
real temporary Git operations, terminal fixtures, database persistence, and server
restart. They do not authenticate a real provider or establish native desktop
behavior on every platform.

## Known Limitations

The October 12 stall, where pending Claude Mod activity reports delayed queued
prompts after a forced restart, is fixed and covered by automated checks; see
[Restart and queued prompts](claude-activity.md#restart-and-queued-prompts). An
authenticated live retest is still to be recorded. Treat restart persistence and
successful prompt delivery as separate checks.

Broader platform support needs the native workflows in
[Platform Testing](PLATFORM_TESTING.md), including authenticated agents, permission
prompts, attachments, an independently reviewed change, and restart recovery.
Report the exact candidate and platform when recording results.

See [Installation](INSTALLATION.md) for prerequisites and
[Releasing](RELEASING.md) for the release checklist.
