# Security

HeloScrum is an early alpha for a trusted, local, single-user workstation.
The currently published alpha is the supported security reporting target.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/YokiiDesu/heloscrum/security/advisories/new).
Include the affected version, a minimal reproduction with synthetic data, and
the impact. Do not include live credentials or personal agent transcripts.
If private reporting is unavailable, open a minimal issue asking the maintainer
for a private channel without disclosing the vulnerability. There is currently
no promised response time or security support SLA.

## Trust boundaries

- Keep the backend on loopback. It is not an internet-facing or multi-tenant service.
- Agents, MCP servers, and custom executable tools can act with your local account's
  permissions. Git worktrees isolate changes, not operating-system access.
- `.heloscrum/` holds private state, provider identifiers, prompts, messages, and
  credentials. Do not publish it or include it in an issue attachment.
- Native providers use their own logins. Remote model and summary connections send
  the configured context to that service; local storage does not mean all inference
  stays on your computer.
- Treat downloaded repositories, Markdown, tool output, and agent messages as
  untrusted input. Review tool permissions and material changes before approval.

The public website is static and never serves the backend or runtime data.
