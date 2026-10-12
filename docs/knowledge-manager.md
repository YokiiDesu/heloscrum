# Knowledge Manager role guide

The Knowledge Manager makes project knowledge accurate, usable, findable and
maintainable. Its remit includes documentation governance for the codebase and
website, plus decisions, lessons learned and continuity across sessions.

The [role pack](claude-role-packs.md) exposes the current assignments, reference
metadata, reports and recorded reviews. Its guide is available to Claude through
`role_pack_view` and in `/heloscrum → Roles`. It does not create another agent,
automatically change documents, or confer policy authority.

## Establish the documentation system

Start with the current brief and existing standards. Identify the policy owner,
applicable policy revision, document types, audience and approval path. Define
missing standards as proposals until the authorized owner adopts them. Do not
turn an optional starter template into a mandatory project rule.

Cover these responsibilities within the assigned scope:

| Area | Work and evidence |
| --- | --- |
| Capture and creation | Capture repeatable procedures and decisions from their owners. Identify necessary SOPs, codebase references, website help and operational documentation; give each a purpose and audience. |
| Standards and templates | Maintain agreed structure, terminology, style, accessibility expectations, required fields and templates for each document type. Record which revision applies. |
| Classification and labeling | Apply the project's taxonomy, sensitivity classification, document type, stable identifier, tags, lifecycle status and audience. Topic tags and access classifications serve different purposes. |
| Organization and storage | Maintain a canonical location and document register; distinguish the editable source, published page and archived snapshot. Make records discoverable without broadening access. |
| References | Link related SOPs, decisions and source material. Record relevant versions, inspect stale or broken references and preserve redirects when locations change. |
| Ownership and review | Name the author, accountable content owner and required reviewer. Track review dates, change triggers, findings and the evidence used for acceptance. |
| Updating and versioning | Keep revision history, reasons for changes, source dependencies and supersession links. Update affected codebase and website guidance together when applicable. |
| Retention and disposal | Record the established retention rule, archive location and required authorization. Check applicable holds and inbound references before disposition; keep the required disposition record. Do not delete merely because a note is stale. |
| Adoption and improvement | Help contributors use the templates and capture useful working knowledge. Record reader feedback and observed usage or retrieval problems; distinguish measured results from expected benefits. |

HeloScrum's current implementation operates on digital records. A physical record
could be represented by a catalog entry and location under an established policy;
the pack does not manage physical storage or disposal.

## A practical workflow

1. Read the current brief, document policy, templates and register. Identify what
   is established, proposed or unknown, along with the assigned scope.
2. Inventory the assigned documentation. Record its canonical source, published
   location where relevant, owner, classification, tags, version and dependencies.
3. Create or update the needed SOPs and knowledge articles with subject matter
   owners. Use the agreed template and include verification and recovery steps.
4. Review the exact document version against the applicable policy/template
   revision. Record each finding with a location, evidence and recommended action.
5. Obtain the required review or approval, update the register and revision
   history, and publish only through the authorized workflow.
6. Revisit documents on their agreed review date or when their sources change.
   Update, supersede, archive or propose disposal under the established policy.
   Collect feedback on whether people can find and use the result.

Use the optional [SOP template](templates/sop.md) and
[document register template](templates/documentation-register.md) as starting
points when no project template exists. Agree a retention period with the
appropriate owner; the pack does not prescribe one.

## Record findings precisely

| Finding | Meaning |
| --- | --- |
| Standard not established | No applicable adopted rule was identified in the sources inspected. Propose one or identify its owner; do not invent a violation. |
| Metadata not established | The owner, classification or other field has not been verified. Its absence from a preview does not prove it is absent from the document. |
| Not reviewed | The document contents or relevant requirement have not been checked. A path, attachment hash or passing build does not constitute a content review. |
| Observed mismatch | Cite the rule and policy revision, exact document version/location and evidence showing the mismatch. |
| Verified against stated checks | State the checks performed and their limits. Do not imply broad regulatory certification or checks that were not performed. |
| Superseded | Link the replacement and retain history according to the applicable policy. Supersession alone does not authorize deletion. |

For example: “SOP-012 revision 3, Owner field: missing. Documentation standard
revision 2 requires an accountable owner. Review performed on the attached
snapshot with the recorded hash.” That is stronger evidence than “documentation
is noncompliant.” A template proposal is not the established standard.

## Reading the current workspace

- **Assigned work & criteria** displays the agent's task criteria; these may
  include other duties when multiple packs are enabled. Criteria are not adopted policy.
- **Document references** lists unique saved attachments from accessible active
  plans, with location and content hash. It is not a repository crawl or complete
  document register. Source revision refers to the brief, not document version.
- **Author reports** shows observations. **Recorded verification**
  shows the separate verification records, including who recorded them.
- **Notebook & source freshness** and **Shared knowledge** retain decisions and
  unresolved questions with source revisions. A stale source is a prompt to
  recheck it, not proof that every statement is wrong.

Open the full document, current policy and register before making a judgment.
Preserve existing board permissions and sponsor acceptance. The pack's guidance
does not authorize changing access, publishing content, deleting records or
approving the agent's own work.

## Background

TechTarget's [overview of a knowledge manager's responsibilities](https://www.techtarget.com/enterprise-software/feature/What-does-a-knowledge-manager-do)
describes knowledge capture, maintaining a knowledge base, supporting knowledge
sharing, editing content and monitoring the program. This project applies those
ideas to the user's broader documentation-governance remit, including SOPs,
classification and the document lifecycle.
