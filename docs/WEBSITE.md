# Website

The public website is [yokiidesu.github.io/heloscrum](https://yokiidesu.github.io/heloscrum/).
Its source is the plain HTML, CSS, JavaScript, and assets in `website/`.

## Preview and Edit

```sh
npm run website
```

Open the loopback address printed by the preview server. This serves the website;
the HeloScrum application has its own local server.

Use relative links between website pages so the `/heloscrum/` GitHub Pages prefix
works correctly. Application tour links use `publishedWebsiteBase` in
[the guide links module](../dist/tour-steps.js). Public help links must point to
the published site rather than a developer's localhost.

The site includes installation guidance, a copyable AI setup prompt, provider and
role overviews, add-on guides, and articles in `website/blog/`. The local-model
article includes a playable red-ball example and a labeled simulation of its
file write and notebook entry. [Example provenance](LOCAL_LLM_EXAMPLE.md) records
the settings, measured timing, and artifact used in that article.

## Publish

[The Pages workflow](../.github/workflows/pages.yml) uploads only `website/`.
GitHub Actions is the Pages source, and `PAGES_ENABLED=true` enables deployments
when website files change on `main`. The workflow can also be dispatched manually.
Application state, credentials, and the backend are never part of the Pages artifact.

After deployment, check the live home page, installation page, article links,
asset URLs, and embedded demo under the repository prefix. Domain and DNS changes
are separate from this deployment.

## Review Changes

- Check narrow and wide layouts, keyboard navigation, visible focus, and contrast.
- Honor reduced motion. Give animated examples pause/replay controls and useful
  content when JavaScript is unavailable.
- Label simulated interfaces and tool activity clearly. Do not invent model
  reasoning, elapsed times, usage, or results.
- Keep playable examples sandboxed. Do not grant embedded demos application
  credentials or access to local project files.
- Link factual provider setup instructions to their official documentation.
- Run `npm run check` and `npm run release:check` before publishing.
