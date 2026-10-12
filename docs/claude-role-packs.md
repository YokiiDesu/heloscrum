# Claude role packs

Role packs v1 are optional workspaces in the HeloScrum Claude visual Mod. They show
current project evidence and concise role guidance in both HeloScrum and Claude’s
native `/heloscrum` panel. They use the existing agent; no extra agents are created.

## Start here

1. Use an agent whose **provider is Claude Code**. A Claude model through Cursor,
   Kiro or an API connection does not load Claude Code Mods.
2. Open **Role packs** in the agent’s footer, or **Agent settings → Open role packs**.
3. Choose **Manual**, select any combination of the eight packs and save. No Jev connection is needed.
4. Open **Workspace** to inspect the role view. Use **Choose packs** to change it.
5. In a native Claude session with the updated Mod loaded, open `/heloscrum` and
   choose **Roles** (key 4). Keys 5 and 6 move to the previous and next active pack; the counter shows your position. **Role guide** opens
   the guide; **Refresh roles** refreshes the selection and sources.

After updating a checkout, reload the HeloScrum server when its managed agents
are idle. Until then, older servers show an update notice when opening role packs;
the existing chat workspace remains available. This also applies to optional
activity views that the older backend cannot serve yet.

New and existing agents default to **Off**. Saving preferences never restarts a
working agent. The native Mod synchronizes on session start, after a turn, or on
an explicit role refresh. Sessions with an older Mod need an idle restart/resume
to load the updated module. The web view shows whether the native module has
synchronized the current selection; each evidence view carries its source time
and revisions separately.

The base visual Mod retains its existing opt-out and hook/version checks. See
[Claude visual Mods](claude-activity.md). Disabling Claude function hooks or setting
`HELOSCRUM_CLAUDE_ACTIVITY=0` also makes these packs unavailable.

## The eight packs

| Pack | Current view |
| --- | --- |
| Orchestration | Dependency map, owners, attached contracts/resources and handoffs awaiting review. |
| Scrum Master | WIP, blockers, sprint/flow goal, Definition of Done and the eligible review queue. |
| UI / UX Design | Interaction/accessibility criteria, author observations, design/test references and recorded verification. |
| Game Design | Rules, balance and player goals, author playtest notes, supporting resources and recorded verification. |
| QA / Independent Reviewer | Review eligibility, author evidence to inspect, and independent verification records. |
| Data Architect | Data architecture/governance criteria, reported observations, models/contracts/decisions and verification. |
| DevSecOps | Security lifecycle and delivery criteria, author findings, pipeline/runtime references and independent verification. |
| Knowledge Manager | Assigned criteria, document references, author reports, recorded verification, notebook freshness and shared knowledge. |

Views are read-only. A pack is a lens on real records, not a separate execution
workflow. The first release does not run security scans, inspect a database,
generate screenshots, simulate a game, or infer test outcomes from prose. Those
results must be recorded in the normal task evidence and resources. An empty
section remains empty. A resource attachment does not prove the agent read it.
A task’s last update is not presented as its blocker onset time.

Source details include revisions and identifiers. The web renderer uses the same
sanitized Markdown and file-preview handling as chat. Excerpts cover up to six
accessible active plans and six records per section; native panes show up to
three records per section. Read full briefs/resources through the existing
workspace and MCP tools before acting on them.

Role guides are readable in either interface and through `role_pack_view`.
They are not silently injected into every model prompt. The live brief remains
canonical and normal permission checks remain in force.

## Knowledge Manager: documentation governance

This role owns the agreed documentation system for codebases and websites:
standards, templates and SOPs; classification, tags and discoverability;
ownership, canonical storage, citations and versions; review, updates,
supersession, retention and authorized disposal. Knowledge capture, contributor
guidance and reader feedback are part of the role as well as session continuity.

The workspace surfaces assigned criteria and author reports, saved document
references, independent review records, private notebook freshness and available
shared notes. A reference's hash identifies the saved attachment; the **source
revision is the brief revision**, not an inferred document version. The view
does not inspect document contents, infer classifications, invent standards or
certify compliance. Missing metadata, an undefined policy, an unperformed check
and a demonstrated mismatch against a specific policy are different findings.

See the [Knowledge Manager guide](knowledge-manager.md), including starter
[SOP](templates/sop.md) and [document-register](templates/documentation-register.md)
templates. These are optional starting points; the project's established
standards and approval rules take precedence. Selecting this pack does not
authorize publication, changing access, deleting documents or adopting a policy.

## Data Architect: fit the design to the system

This pack covers business requirements, models, cross-system data flows,
contracts, storage and processing, governance, evolution, recovery and cost.
It reflects the broader role described in [Syracuse's role overview](https://ischool.syracuse.edu/data-architect/)
and the supplied project guidance. The college and career material is not part
of the pack. The stored ID remains `database-architect`, so existing pins and
preferences keep working under the new **Data Architect** name.

Start with constraints and inspect the available source schemas and metadata.
Choose diagrams, engine-specific schemas and architecture decisions that make
the proposal reviewable. Match technology to observed workload and budget; no
warehouse, streaming platform, cloud vendor or modeling pattern is mandatory.
Unknown scale, latency, cost and policy requirements stay explicit assumptions.
The pack does not create connections, run migrations or provision infrastructure.

Data governance concerns the meaning, ownership and lifecycle of system data.
Knowledge Manager governs the documentation system. DevSecOps covers security
through delivery and operations; QA verifies concrete results independently.
Several packs can apply when an agent has several assigned responsibilities.
Naming these responsibilities does not add agents or grant new permissions.

## DevSecOps: security throughout delivery

The guide follows [Red Hat's DevSecOps overview](https://www.redhat.com/en/topics/devops/what-is-devsecops):
security is shared work across the lifecycle, with early risk decisions, automated
delivery controls and continued runtime follow-up.

HeloScrum displays the assigned criteria, reported observations, attached
references and verification records. These are excerpts from current records;
the pack does not inspect repositories, pipelines or running services. Record
the artifact revision, environment, reproduction and responsible owner in task
evidence. Missing evidence stays missing. Exception approval, access changes
and release authority remain with the project's designated decision-makers.

## Off, Manual and Jev Auto

- **Off:** base activity only. No role-selection inference.
- **Manual:** any combination of installed packs selected by you. No role-selection inference.
- **Jev Auto:** Jev evaluates the actual role description and current assignments.
  Optional manual pins stay selected; Jev adds every matching unpinned pack.
  Pinning the whole catalog requires no inference. All unpinned packs may be rejected.

For Auto, select a Jev decision connection in **Project settings → AI & context**,
then explicitly enable Auto for the agent. A bounded role description, assigned
duties, acceptance excerpts and coordination metadata are sent to that service.
Transcripts, private peer notebooks and full project files are not sent.

Eight independent Noul questions are submitted in one request. Code validates
all expected answer IDs/types, finite probabilities and the 0–1 range. Matches
at or above **0.60** are sorted, with manual pins first. Every matching installed
pack remains active; there is no two-pack cap. Policy v2 bounds the result by the
installed catalog size (currently eight). The threshold is a product policy tested
on the fixtures below, not a
universal calibration claim. Near-boundary results can vary; Manual is available.
The UI can show the actual scores, returned model, policy, time and measured usage.
It does not manufacture a natural-language model explanation.

The saved decision fingerprint includes the provider, role and assignment
content, connection/model revision, installed catalog, questions and policy.
Board revision-only updates and changing progress notes refresh the view without
another inference. Changed duties invalidate old automatic selections. Stale
in-flight results cannot overwrite newer preferences or duties.

Runtime bounds: six attempts per agent per hour, at least one minute between
attempts, two concurrent decisions, a six-second request timeout and a 14,000
character state limit. Unchanged decisions survive server restarts. Normal web
view refreshes are read-only and never invoke Jev. The Mod checks at turn/session
boundaries; unchanged input reuses the saved result. Failed decisions are not
retried in a loop. Use **Re-evaluate duties** after resolving the cause, subject to
the same limits.

Missing evidence, invalid model output, connection rejection, integration errors,
service unavailability/timeouts, storage failures and rate limits have separate
fallback states. Valid manual pins remain; no automatic pack is invented.

## Permissions and records

Only the authenticated human API can change pack settings. The scoped
`role_pack_view` and `role_pack_sync` tools accept the current Claude session ID;
the server supplies the agent identity. They are unavailable to external contacts
and other provider types. Sync cannot enable Auto or change pins.

QA eligibility uses existing board rules: no owner/contributor self-review,
delegated authority when required, active managed plan, Needs Review state, and
finished dependencies. Selecting QA or Scrum Master grants no review authority.
No pack changes tasks, sends messages, approves tools, installs plugins, deploys,
or changes sponsor-controlled acceptance.

Selection attempts are persisted under
`.heloscrum/agents/<agent-id>/context-usage/` with kind `role-pack-selection`:
exact state/questions, policy/fingerprint, raw answers, candidate selection,
current/stale disposition, model, latency timestamps and returned usage. Missing
usage remains unknown. UI preferences and selection snapshots live with the
agent in durable HeloScrum state. Credentials remain in the private AI connection
store and are never sent to the Mod.

## Verification and Limits

[The fixture set](../test/fixtures/role-pack-cases.json) contains 56 synthetic
role-selection cases. These are development inputs, not an independent accuracy
estimate. Use separately labeled holdout cases before tuning question wording or
thresholds. Manual pins remain available when Auto does not match the intended scope.

Automated tests cover manual pins, multiple selected roles, provider and access
boundaries, malformed answers, stale-result races, and review permissions. Native
Mod tests cover navigation, guides, pagination, and failed pagination. Test the
browser renderer and a real Claude session separately when changing those surfaces.

Evaluation reports should retain exact questions, supplied states, expected labels,
raw answers, model, measured usage, and any reused-answer provenance. Synthetic
agreement does not establish productivity or end-user quality. Runtime policy and
execution limits remain in code.

To perform a new live evaluation with an existing configured connection:

```sh
node scripts/evaluate-role-packs.mjs --run-live --runtime /path/to/heloscrum-runtime --output /tmp/role-pack-evaluation.json
```

The command runs the 56 current fixtures, with a hard limit of 64 sequential,
bounded requests. It refuses to overwrite
an existing output file. It is a deliberate evaluation harness, separate from the
six-per-hour runtime policy. Expected labels and holdout splits must be established
before using the results to adjust a policy.

## Sources and implementation

The implementation follows the current [Claude Mods API](https://code.claude.com/docs/en/plugins/mods/api),
[Mod events](https://code.claude.com/docs/en/plugins/mods/events),
[TypeSafe API](https://docs.typesafe.ai/api), [Noul guidance](https://docs.typesafe.ai/primitives/noul),
[state guidance](https://docs.typesafe.ai/concepts/state) and
[skill-suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion).
Noul was chosen because several packs may apply independently; the service
judgment does not measure the probability that an entire workflow will succeed.

The installed catalog is `dist/role-pack-catalog.js`; policy and structured
questions are in `lib/role-pack-selection.mjs`; authorization, durable selection
and bounds are in `lib/role-packs.mjs`. `lib/role-pack-panels.mjs` supplies shared
structured evidence to the web renderer and native Mod. There is no remote pack
installation or automatic arbitrary-code loading.
