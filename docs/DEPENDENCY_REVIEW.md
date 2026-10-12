# Dependency Review — October 11, 2026

A fresh `npm ci` completed and the 439-test suite passed in UTC. The install audit reports five package entries from two underlying advisories: three moderate entries and two low entries, with no high or critical entries. An audit count is not an independent security assessment.

## Mammoth, argparse and sprintf-js

[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) concerns attacker-controlled precision format strings in sprintf-js. The current official package version is 1.1.3 and the advisory lists no patched version. Mammoth 1.13.0 depends on argparse 1.x for its command-line executable; argparse brings sprintf-js.

HeloScrum's document converter runs the prebuilt Mammoth browser bundle in a worker, with external file access disabled. The checked browser bundle contains neither argparse nor sprintf references. The repository does not invoke Mammoth's command-line program or import its argument parser. This documents the observed application boundary, not a claim that all possible future use is safe. Keep the advisory tracked and revisit if document processing changes.

The automatic fix suggests downgrading Mammoth to 0.3.29. That would replace the modern document converter and is not an appropriate release fix.

## Mermaid and KaTeX

[GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) requires existing prototype pollution to bypass KaTeX trust restrictions. The fresh install still has an affected transitive version under Mermaid 12.1.0. HeloScrum configures Mermaid with strict security and disabled HTML labels, then sanitizes rendered SVG with DOMPurify, excluding foreignObject, links, images, scripts and href attributes.

Those are defense boundaries, not proof that the dependency advisory is eliminated. Mermaid ships bundled browser chunks: merely overriding the separately installed KaTeX package would not establish that the code served to users is patched. The suggested Mermaid downgrade is also inappropriate. Retain the advisory as a reviewed residual item, track an upstream bundled fix, and require a final release decision on the exact candidate. No forced downgrade or cosmetic audit suppression was applied.
