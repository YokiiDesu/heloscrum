# AI connections and working context

Open **Project settings → AI & context** to save named model connections and
configure context management. Connections and context defaults belong to this
HeloScrum backend and are shared across projects. Agent profiles still control
whether an agent is available globally or in a specific project.

For a complete llama.cpp walkthrough with exact Muse Glimmer settings and a playable
example, see the [local LLM article](../website/blog/local-llms.html).

## Connect A Running LM Studio Model

Open **Settings → AI & Context → Add Connection** and choose **LM Studio**.
You can also select LM Studio while creating an agent or editing its profile,
then click **Set Up LM Studio** (or **Set Up A Connection**). Setup opens over
your agent form, so its unfinished fields stay in place.

1. Start LM Studio's local API server and load the model you want to use.
2. Keep `http://127.0.0.1:1234/v1` for a server on the same computer, or enter
   its configured address.
3. Click **Discover Models**. HeloScrum lists models without sending project
   content or saving a connection. With recent LM Studio versions, loaded
   models appear first and their active context limit and reported tool/image
   capabilities fill into the form when selected.
4. Review the model and limits. Enable tool calling for an agent model; leave
   it off for a model you only want to use for summaries. Save the connection.
5. Back in the agent form, choose that connection. In **AI & Context**,
   **Test Connection** makes a small inference request to check the server.

**Connection needed** means HeloScrum has no enabled, tool-capable connection
for that provider. It does not mean LM Studio is missing from your computer.
An open LM Studio window alone isn't sufficient: its API server must also be
running. Older compatible servers still support model discovery without the
extra loaded-model metadata. Reported tool support does not guarantee that
every model handles complex coding tasks reliably.

Loaded-model metadata follows the [LM Studio models API](https://lmstudio.ai/docs/developer/rest/list).

## Connect a model

Save a separate connection for each server/model combination you want to select
by name. Two connections can use the same URL with different default models.
Agents select a **provider**, **connection**, and **model** independently.

| Service | Connection | Requirements |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` by default | Running OpenAI-compatible API, downloaded model |
| llama.cpp | `http://127.0.0.1:8080/v1` by default | Running `llama-server`, loaded model and appropriate chat/tool template |
| LM Studio | `http://127.0.0.1:1234/v1` by default | Developer API server enabled and model loaded |
| Amazon Bedrock | AWS region, optional profile, model/inference-profile ID | AWS CLI v2, authenticated profile/default credentials, Converse-compatible model and invoke permission |
| Amazon SageMaker AI | AWS region, optional profile, endpoint name, model ID | AWS CLI v2, invoke permission, compatible deployed inference container |
| Jev / TypeSafe | TypeSafe API key, `jev-latest` | Context decisions only; select a separate generative model for summaries |
| Claude Code summaries | Installed, signed-in Claude Code CLI; exact model ID | Summary-only connection; uses existing account with tools and MCP disabled |
| Codex summaries | Installed, signed-in Codex CLI; exact model ID | Summary-only connection, using the existing CLI account; cannot create endpoint agents |
| Cursor CLI | Installed and signed-in `cursor-agent` (or an explicit binary path) | Native CLI account; no model-server connection needed |

Use **Discover models** for the local OpenAI-compatible servers. AWS model IDs
and endpoint names are entered explicitly. **Test connection** makes a small
inference request; it verifies basic generation, not every model's tool support.
Saving a connection does not make an inference request.

### Slow Local Responses

LM Studio, Ollama, and llama.cpp responses stream into HeloScrum. An agent card
shows **Waiting For Model** until generation starts, then **Receiving Response**
while the server sends output. Tool calls are assembled and validated before
execution; private reasoning text is not copied into the conversation.

Local requests allow up to five minutes for startup, two minutes of silence
after generation starts, and thirty minutes overall for one response. Active
generation is no longer cut off after ninety seconds. **Interrupt** cancels a
request immediately. A timeout explains whether startup or generation stalled;
HeloScrum does not automatically resend the inference or run incomplete tools.
Completed tool actions from earlier steps remain in the conversation.

If the model reaches its output token limit, increase **Maximum Output Tokens**
in the connection settings or lower its reasoning budget in the model server.
Reasoning models can spend much of the output budget before producing a reply.
If startup still times out, check the model server's load, queue, and memory use.

The local transport uses the documented streaming interfaces from
[LM Studio](https://lmstudio.ai/docs/developer/openai-compat/tools#streaming) and
[llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).
For llama.cpp, enter the address printed by your server, including `/v1`; its
configured port may differ from HeloScrum's suggested `8080`.

Check **This model supports tool calling** only after confirming support in the
loaded model and server configuration. This enables agent creation through that
connection. Models without tool calling can still generate summaries. Set the
context window to the actual server configuration, which can be smaller than the
model's advertised maximum; HeloScrum does not change a model server's settings.

Check **This model supports image input** only for a model and endpoint that
accept multimodal messages. Attached images are sent as image content, not as
base64 text in a prompt. Bedrock image input uses Converse; WebP attachments must
be converted to PNG, JPEG, or GIF for that adapter. Text/code attachments can be
read in bounded pages through `attachment_read` without enabling image support.
Native CLI agents use the same tool for images, text, and references to original
files; binary document extraction depends on the provider's available tools.
Endpoint agents reject unsupported binary attachments with an actionable error.
Checkpoint summaries keep attachment references and omit image bytes.

`localhost` means the computer running **HeloScrum's backend**. A model on another
machine needs a reachable LAN/VPN address or a tunnel with its own local port.
For example, `http://192.168.1.33:11434/v1` reaches that machine, while a tunnel
could expose it as `http://127.0.0.1:11435/v1`. Use an authenticated endpoint or a
trusted private network. Model inference happens remotely; worktrees, file tools,
and shell commands continue to run on the HeloScrum backend computer. This is
remote inference, not distributed workspace execution.

API keys are stored in `.heloscrum/ai-credentials.json` with owner-only permissions.
They are not returned to the browser or copied into saved project history. Leave
the key field blank when editing to retain it, or use **Remove saved key**.
AWS credentials use the AWS CLI's existing credential chain; enter profile names
in HeloScrum, not AWS access keys. A disabled connection stops further inference
through it. Connection settings affect subsequent requests by agents using it.

### SageMaker container contract

The adapter uses AWS CLI `sagemaker-runtime invoke-endpoint` with a JSON body
containing `model`, `messages`, `stream: false`, `max_tokens`, and optional `tools`
and `tool_choice`. The deployed container's `/invocations` handler must accept
that Chat Completions shape and return `choices[].message` with text and/or tool
calls. An arbitrary SageMaker endpoint with a custom request/response schema will
not work. Endpoints exposing only a separate `/openai/v1/...` route need a
compatible `/invocations` handler for this adapter.

### Cursor sessions

Install and sign in through Cursor's official CLI, then restart HeloScrum so it
discovers the executable. `HELOSCRUM_CURSOR_BIN` can select an explicit binary, including Cursor installations that expose only `agent`.
Use **Auto** or an exact model ID available to that account. HeloScrum uses a
saved Cursor chat ID, headless `stream-json` output, and the native sandbox.
It does not enable force approval or automatically approve MCP servers.

The HeloScrum MCP bridge is added to `.cursor/mcp.json` in the assigned worktree,
preserving existing entries and refusing to overwrite a conflicting `heloscrum`
entry. Initial login or MCP approval may require using Cursor's CLI directly in
that worktree. Chat and Block views show visible assistant responses and tool
activity; a native interactive terminal is not attached to this adapter.

## Context decisions, summaries, and retrieval

Jev chooses between structured options; it does not write summaries. Configure a
**Jev connection** for context decisions and a **summary model connection** for
generative checkpoints. A local summary model can keep the larger source records
on your machine. When enabled, Jev receives a bounded task/status snapshot and
recent excerpts, not the full accumulated transcript. A remote summary connection
receives the records selected for summarization.

New Jev setup includes a checkpoint summary-model choice. Saving tests that model
and selects the pair for context management. Existing incomplete setups show
**Finish checkpoint setup**, with **Pair with Luna** and **Pair with Sonnet**
actions when the respective CLI is installed. Luna uses `gpt-6-luna`; Sonnet uses
the verified `claude-sonnet-5` ID. Both run with low reasoning effort and the
signed-in CLI account. Setup tests the model before selecting the pair and
preserves the working budget. Model access is verified by the test rather than inferred from
the executable being installed. Manage the connection to choose another model.

Native summaries send only the supplied checkpoint records to the selected provider in a fresh
ephemeral invocation. Codex uses a temporary working directory, stdin, read-only
sandboxing, no user CLI configuration, and disabled shell, apps, hooks, and delegation.
Claude uses safe mode, strict MCP configuration, no built-in tools, and no saved session.
Claude model usage is checked against the requested model; a mismatch is reported. They do not resume an existing agent conversation.
The summary connection's context window is a conservative request budget, not a
change to the provider's actual model capacity. Jev assessments can still run
without a summarizer; reviewed native checkpoints need the configured pair.
See [Codex noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode) and
[Claude CLI reference](https://code.claude.com/docs/en/cli-reference).

- **Large tool results:** long text is saved under the agent's stable identity.
  The agent receives a bounded preview and reference. `context_search` finds
  relevant passages; `context_read` retrieves pages of up to 8,000 characters.
  References remain available after a provider/session change. MCP image blocks
  are preserved when adjacent text is shortened.
- **Endpoint agents:** before each model call, HeloScrum estimates input size,
  including tool schemas. Near the configured budget, Jev can recommend an early
  checkpoint. Assessments require substantial context growth, avoiding a decision
  call for every step. The hard budget applies even if Jev recommends continuing
  or is unavailable. Compaction preserves the original task, latest user request,
  and complete recent tool exchanges. The selected summary model is used, or the
  agent's own model when none is selected. Unusable summaries pause work while
  keeping the previous input and archived records.
- **Native CLI sessions, including Cursor:** in agent settings choose **Assess
  context**, then **Prepare checkpoint**. Review/edit the handoff and choose
  **Start fresh with this handoff**. This is a deliberate session rotation; it
  does not silently discard the provider's live context. The agent must be idle.
  A changed transcript invalidates the preview. Files, branch, task permissions,
  agent identity, and earlier transcripts remain available.

Native checkpoints include the original brief, previous checkpoint, file status,
and bounded recent excerpts. The preview states how many transcript events it
covered; it does not claim to summarize omitted history. References allow agents
to search the original records when needed. Summaries can omit or misstate details,
so review critical constraints and verification claims before applying them.

Transcript/input token estimates are heuristics, not provider billing measurements.
They cannot measure hidden native CLI context or establish savings on their own.
Measure uncached input, cached input, output, repeated messages, and completed work
separately when comparing runs. This change does not retroactively alter provider
usage records or existing agent conversations. Managed session files retain
per-request provider usage when supplied, labeled as agent, summary, or decision
requests; these records are not added to the model's input conversation.

## Endpoint agent behavior

The HeloScrum runtime keeps a saved transcript and model conversation for each
session. It offers bounded file read/list/write tools and access to the existing
scoped MCP/toolbox, task, and collaboration operations. Shell commands wait for
a matching, one-time human approval. File tools reject traversal, symlinks, Git
internals, provider configuration, and common credential paths. These checks are
not an OS sandbox: an approved command runs with your account's permissions.

Turns stop after a substantive response or at the 24-step guard. Network failures
are not silently retried. After a backend restart, use **Projects → Resume saved
session**; the original task is not replayed. Text, tool messages, and supported image attachments are sent
by the endpoint model transport. Images require the connection's image-input
capability to be enabled; audio and a native terminal are not provided.

The versioned API's agent-create body and CLI JSON input accept `connectionId`
alongside `kind` and `model`. Connection administration and checkpoint preparation
currently use authenticated local UI routes (`/api/ai-connections`,
`/api/context/*`); those are not a promised external versioned API.

## Saved Connection Status

Agent forms show **Connected** with a green indicator for a saved local connection
whose model server is reachable. This checks the model catalog; it does not generate
a response or send project content. An unloaded or unavailable model gets a clear
status and **Check Again**. Use **Settings → AI & Context → Manage** to edit an
existing connection. Setup appears only when no suitable connection is selected.

Repeated setup of the same local server, model, credentials, and settings reuses
the saved connection. Different settings must be edited through Manage; they do
not silently replace an existing configuration. Different servers, models, or
credentials remain separate. A bare server address gets the standard `/v1` path.

Unused local connections can be archived in AI & Context. They leave the pickers
but retain their settings and saved keys under **Archived Connections**, where
**Restore** brings them back. Connections still assigned to an agent, profile, or
summary setting must be unassigned first. Saved session history is kept.

## References

- [TypeSafe API](https://docs.typesafe.ai/api) and [coding agents](https://docs.typesafe.ai/introduction/coding-agents)
- [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility)
- [llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)
- [LM Studio compatibility](https://lmstudio.ai/docs/developer/openai-compat)
- [Cursor CLI parameters](https://cursor.com/docs/cli/reference/parameters) and [output format](https://cursor.com/docs/cli/reference/output-format)
- [Bedrock Converse](https://docs.aws.amazon.com/cli/latest/reference/bedrock-runtime/converse.html)
- [SageMaker OpenAI compatibility](https://docs.aws.amazon.com/sagemaker/latest/dg/realtime-endpoints-openai-compatible.html)
