# Release Checklist

HeloScrum is a public source alpha. A stable release requires the platform and
provider evidence described in [Release Status](RELEASE_STATUS.md).

1. Prepare a clean candidate. Exclude runtime data, credentials, machine-specific
   paths, unrelated project material, generated output, and private development reports.
2. Check `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`, including copied assets.
3. Run `npm ci` and `npm run test:platform`. Check the matching GitHub CI results.
4. Scan the candidate and Git history with a secret scanner using redacted output.
   Review project names, links, and documentation manually as well; secret scanners
   do not identify every private reference.
5. Follow [Getting Started](GETTING_STARTED.md) with a fresh data folder and a
   disposable Git project. Complete the authenticated builder/reviewer workflow
   in [Platform Testing](PLATFORM_TESTING.md). Record unrun checks explicitly.
6. Check the app and website with keyboard input, narrow layouts, both themes,
   and reduced motion. Verify attachment previews and public tour links.
7. Record the exact revision, platform, commands, outcomes, and limitations in
   release notes. Publish a prerelease tag for an alpha after release approval.

## Website Deployment

The [Pages workflow](../.github/workflows/pages.yml) publishes only `website/` to
[GitHub Pages](https://yokiidesu.github.io/heloscrum/). Configure Pages to use GitHub
Actions and set `PAGES_ENABLED=true` for automatic deployment. Verify the deployed
site after the workflow completes. Domain and DNS configuration are separate.

Keep `private: true` in `package.json` until npm publication is separately prepared.
That setting prevents accidental npm publication; it does not make GitHub private.
