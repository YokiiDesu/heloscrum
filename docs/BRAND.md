# HeloScrum Identity

HeloScrum pairs the introduction behind SMTP's `HELO` with the teamwork behind
Scrum. Spell the product name **HeloScrum**, with a capital H and S.

## The Handoff H

The original vector mark uses two opposing, open paths joined by a shared bridge.
Together they form an H: two agents working on a shared outcome. The mark uses no
third-party icon or font outlines.

- **Hello coral:** `#FFAB76`
- **Connection mint:** `#85D8C6`
- **Workspace ink:** `#132126`

Use the framed icon for favicons and app surfaces, the transparent mark beside
the wordmark, and the monochrome mark for single-color reproduction. Retain the
empty space in each SVG viewBox. Minimum icon size is 16 CSS pixels.

- [App icon](../dist/brand/heloscrum-icon.svg)
- [Transparent mark](../dist/brand/heloscrum-mark.svg)
- [Monochrome mark](../dist/brand/heloscrum-mark-mono.svg)

Start the backend and visit `/brand` for size samples and download links.

## Technical Names

| Surface | Name |
| --- | --- |
| Package and command | `heloscrum` |
| Private workspace data | `.heloscrum/` under the configured data root |
| Data root override | `HELOSCRUM_ROOT` |
| Executable overrides | `HELOSCRUM_<PROVIDER>_BIN` |
| Agent tool environment | `HELOSCRUM_AGENT_ID` |
| Browser preferences | `heloscrum.*` |
| Browser API authentication | `X-HeloScrum-Token` |
| Agent MCP namespace | `heloscrum` |
| History export format | `heloscrum-history` |
| Chat delivery envelopes | `HeloScrum` |

Private workspace data and credentials are excluded from Git and the website.
