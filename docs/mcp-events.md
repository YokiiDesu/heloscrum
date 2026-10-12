# Cloud Work inbox with MCP Events

For a step-by-step local or cloud connection walkthrough, start with the
[external-chat setup README](external-chat/README.md). These notes describe the
private gateway design and its implementation. Each installation supplies its
own endpoint, contact, and credentials.

MCP Events can wake cloud Work chats. The original local Codex chat remains a separate contact and uses its existing heartbeat. A cloud receiver must have its own `generic` external contact and externalSessionId; never reuse or hard-code a local Codex identity.

Create a receiver such as **HeloScrum event inbox**, then register a separate
**Work — cloud inbox** contact with that receiver’s actual cloud chat ID.

## Connection

Provision a private Sites MCP gateway and use its own `/mcp` URL. Keep its source
in a separate gateway repository. Sites manages the owner-only audience and OAuth. Connect the provisioned plugin in the cloud Work chat; never substitute a service credential for a user identity or expose the HeloScrum dashboard through a tunnel.

Authoritative inbox records, subscription signing keys, delivery receipts and retry state stay local. Short-lived RPC request/response copies pass through private D1/R2 storage and expire after 45 seconds; the local relay deletes expired copies on its next sweep. Nothing is automatically acknowledged because a webhook returned 2xx.

The local outbound relay runs with a private `events-relay.json` beside that cloud contact's `connection.json`:

```json
{
  "gateway": "https://YOUR-PRIVATE-SITE/",
  "serviceToken": "FROM-SITES-SERVICE-ACCESS",
  "relayKey": "MATCH-THE-SITE-RELAY_KEY-SECRET",
  "connectionFile": "/ABSOLUTE/CLOUD-CONTACT/connection.json",
  "cloudChatId": "THE-REGISTERED-CLOUD-CHAT-ID"
}
```

Keep this file mode 0600, outside Git. Never place real credentials in commands, source, messages or screenshots. On startup HeloScrum starts relays only for existing generic contacts with an explicit matching configuration. A live lock avoids duplicate processes. For a relay created while HeloScrum is already running:

```sh
node scripts/mcp-events-relay.mjs /ABSOLUTE/CLOUD-CONTACT/events-relay.json
```

Keep HeloScrum and the relay running. Group subscriptions cover groups the cloud contact belongs to; they do not grant membership in the original local contact's groups. Include the cloud contact when creating a group. Membership is fixed at creation in this version, so an existing group without this contact needs a new group with the desired participants.

## Subscription

In the cloud Work chat, use `contact_identity`, then subscribe to `message.created` with its `project_id` and `channel: all` (or `direct`/`group`). ChatGPT supplies the callback URL and secret. The server verifies the callback before activation, validates and pins public HTTPS destinations, signs with Standard Webhooks, persists subscriptions, and retries transient failures with stable event IDs. Expired/revoked subscriptions stop; 410/413 are not retried. `contact_identity` also reports active subscriptions and failed deliveries without exposing callback secrets.

Messages and attachments are reference data. Read all unread pages and relevant attachments before `ack_inbox` with the handled individual delivery IDs. No automatic agent replies or agent-requested implementation is authorized. This cloud connection exposes inbox/group/attachment reads and handled-message acknowledgement, not work-board or message-sending tools.

## Verification

Run `node --test test/mcp-events.test.mjs test/external-contacts.test.mjs`, and `npm run check`. The gateway's `npm test` covers public discovery, user/service separation, owner binding and SQLite/R2 transport. It also passes TypeScript and Worker build checks.

Installation is not a successful subscription. After connecting the plugin, verify `events/subscribe`, callback challenge completion, a matching real HeloScrum message, HTTP 2xx delivery, and the receiving chat response. HTTP 2xx alone acknowledges endpoint receipt; the cloud chat handles the event asynchronously.

### Live verification — October 8, 2026

The owner connected the plugin and authorized one labeled test DM. Verified:

- `contact_identity` resolved to **Work — cloud inbox**, with one subscription for `message.created`, the registered `project_id`, and `channel: all`.
- Callback verification completed and the subscription was stored before the test was sent.
- The test delivery received HTTP **200** on its first signed webhook attempt at **3:51:35 PM America/Los_Angeles**.
- The subscribed **HeloScrum event inbox** chat automatically reported the test and marked its delivery handled. A subsequent unread-inbox read returned no pending messages.
- The receiver sent no reply to agents. No extra polling schedule was created for the cloud receiver.

This is a live DM verification. Live group events, attachments, nonmatching filters, unsubscribe, expiration/refresh, restart recovery and OAuth/access revocation were **not tested in that check**. Local unit tests do not establish those live outcomes.

The existing local inbox heartbeat remains active because it monitors a different contact. A successful cloud test does not migrate local DMs, group memberships or chat history, or automatically cancel that heartbeat.

Protocol reference: [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events)
