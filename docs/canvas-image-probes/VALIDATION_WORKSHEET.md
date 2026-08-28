# Canvas embedded-image validation worksheet

Copy this file for an evidence run. Do not replace blank fields with assumptions. Attach raw HTML,
screenshots, API responses, Files listings, and re-export archives under an adjacent evidence
directory, using filenames that begin with the probe ID.

## Run identity

| Field | Observation |
| --- | --- |
| Operator | — |
| Date/time and timezone | — |
| Canvas environment/base URL | — |
| Canvas release/build | — |
| Browser/version | — |
| Source course ID/name | — |
| Share/copy destination course ID/name | — |
| Re-export-import course ID/name | — |
| Second Canvas environment/release, or reason unavailable | — |
| Generated `probe-index.json` committed with evidence | — |

## Variant summary

Use `pass`, `fail`, or `not run`, followed by the evidence filename or a concise observation.

| Probe ID | Cartridge SHA-256 | Import status/warnings | Stored page HTML | Rendered images/alt | Files placement | Shared-image behavior | Duplicate-byte behavior | Same-cartridge reimport | Share/copy behavior | Re-export and clean reimport |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `standalone-webcontent` | — | — | — | — | — | — | — | — | — | — |
| `webcontent-dependencies` | — | — | — | — | — | — | — | — | — | — |
| `page-owned-files` | — | — | — | — | — | — | — | — | — | — |
| `associatedcontent-dependencies` | — | — | — | — | — | — | — | — | — | — |

## Per-variant detail

Duplicate this section once for each probe.

### Probe: `<probe-id>`

- Cartridge filename:
- SHA-256 from `probe-index.json`:
- Clean source course confirmed:
- Import status, duration, and warnings:
- Page count after first import / second import:
- File count after first import / second import:
- Import evidence files:

| Page | Stored `img src` and `alt` | Rendered URL and natural size | Result/evidence |
| --- | --- | --- | --- |
| `01-single-image` | — | — | — |
| `02-shared-image-a` | — | — | — |
| `03-shared-image-b` | — | — | — |
| `04-raster-and-duplicates` | — | — | — |

| Packaged fixture | Resulting Canvas Files path/ID | First and second import behavior | Re-export path/hash | Result/evidence |
| --- | --- | --- | --- | --- |
| `single.png` | — | — | — | — |
| `shared.gif` | — | — | — | — |
| `raster.png` | — | — | — | — |
| `raster.jpg` | — | — | — | — |
| `raster.webp` | — | — | — | — |
| `duplicate-a.png` | — | — | — | — |
| `duplicate-b.png` | — | — | — | — |

- Do both shared pages resolve to the same Canvas File? Evidence:
- Did replacing/editing the shared Canvas File affect both pages? Evidence:
- Did duplicate bytes remain distinct or deduplicate? Evidence:
- Share/copy operation used and result in destination course:
- Re-export filename and SHA-256:
- Re-export `unzip -t` result:
- Re-export manifest/resource observations:
- Clean import of the re-export:
- Media-specific failures or Canvas rewriting:
- Other warnings or deviations:

## Decision

- Winning probe ID, or `none`:
- Exact winning asset resource shape:
- Exact winning page-to-asset relationship:
- Exact winning HTML reference form:
- Supported media types proved individually:
- Files placement that production should expect:
- Shared and duplicate-byte behavior production must preserve:
- Reimport behavior:
- Share/copy behavior:
- Re-export and clean-import behavior:
- Second-environment differences:
- Known limitations:
- Evidence paths:

### Production-exporter gate

- [ ] All four variants were run from hashes recorded above.
- [ ] Stored HTML and rendered DOM/URL evidence are attached for all pages.
- [ ] Files placement, shared-image, and duplicate-byte behavior are attached.
- [ ] Same-cartridge reimport evidence is attached.
- [ ] Share/copy evidence from a destination course is attached.
- [ ] Re-export archive evidence and a clean import of that export are attached.
- [ ] PNG, JPEG, GIF, and WebP outcomes are decided individually.
- [ ] A second Canvas environment was compared, or its absence is explicit.
- [ ] One strategy passed every required behavior, or the decision is `none`.
- [ ] `.scratch/document-import/issues/07-validate-images-in-canvas.md` records the decision and is resolved.

Production packaged-image work remains blocked until every applicable box is checked and the winning
shape is explicit.
