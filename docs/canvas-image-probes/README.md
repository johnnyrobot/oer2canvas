# Canvas embedded-image probes

These probe cartridges isolate how Canvas imports packaged raster images. They are research
artifacts, not part of the application exporter. Their results must be recorded in
[`VALIDATION_WORKSHEET.md`](VALIDATION_WORKSHEET.md) before production asset packaging changes.

## What is held constant

Every cartridge contains the same four published Canvas pages, seven archive assets, image bytes,
stable identifiers, and HTML. Every `src` is generated as the exact controlled form
`$IMS-CC-FILEBASE$/web_resources/probe/<filename>`; the generator does not accept source HTML or an
arbitrary asset path.

The fixtures cover:

- one PNG used by one page;
- one GIF shared by two pages;
- PNG, JPEG, GIF, and WebP rendering;
- two different PNG paths whose bytes are identical; and
- descriptive, distinct alt text on every occurrence.

Only the manifest relationship between a page and its image assets changes:

| Probe | Asset resource | Page-to-asset relationship |
| --- | --- | --- |
| `standalone-webcontent` | standalone `webcontent` | none |
| `webcontent-dependencies` | standalone `webcontent` | `<dependency>` |
| `page-owned-files` | none | asset is an additional page `<file>` |
| `associatedcontent-dependencies` | standalone `associatedcontent` | `<dependency>` |

The standalone `webcontent` shape is represented in a
[Canvas-maintained example manifest](https://github.com/instructure/common-cartridge-viewer/blob/master/public/test-cartridges/course-1/imsmanifest.xml).
Canvas's importer source recognizes the legacy token and maps it through its course-file map; the
probe still measures the deployed behavior rather than treating source inspection as acceptance.

## Generate and structurally validate

Prerequisites are Node.js 22, `unzip`, and `xmllint`. From the repository root:

```sh
npm ci
npm run probe:canvas-images
```

This writes ignored, reproducible artifacts under `artifacts/canvas-image-probes/`:

- four `.imscc` cartridges;
- `probe-index.json`, which describes each variant and records its SHA-256; and
- `SHA256SUMS.txt` for transferring and identifying the exact inputs.

Generation fails unless each manifest and Canvas module file is well-formed XML, all identifiers
and archive paths are safe and unique, every manifest file exists, every page image resolves to one
packaged entry through the canonical token, all packaged assets are referenced and declared, and
the bytes match their claimed raster type. It then runs `unzip -t` against every completed archive.

To validate an existing generated directory without rewriting it:

```sh
npm run probe:canvas-images:validate
```

Rerunning generation must print the same four hashes. A changed hash means the input changed and
invalidates observations tied to the earlier hash.

## Canvas sandbox procedure

Use only a disposable course on a Canvas environment you are authorized to test. Use one clean
course per variant, or fully reset the course between variants. The probes deliberately share page
identifiers and paths, so importing different variants into one unchanged course would turn the
comparison into an update experiment.

For each cartridge, in the order listed by `probe-index.json`:

1. Copy its filename and SHA-256 into a fresh worksheet row. Record the Canvas environment, observed
   release/build information, browser, course ID, operator, and date.
2. In **Settings → Import Course Content**, select **Canvas Course Export Package**, upload the
   cartridge, import all content, and retain the completed/failed status plus all warnings.
3. Record the Pages and Files counts before opening content. Capture the exact folder and filename
   Canvas assigned to every probe asset, including whether the two duplicate-byte PNGs became one
   file or two.
4. Open all four pages. For every image, record whether it rendered, its final URL, natural size,
   displayed alt text, and any broken-request or console error. Capture screenshots of the full
   pages and browser inspection showing the final `src` and `alt`.
5. Capture the exact stored HTML for all four pages using Canvas's HTML editor or the Wiki Pages API.
   Do not substitute the browser DOM: Canvas can store one value and render another.
6. Compare the two shared-image pages. Record whether their stored references and final attachment
   IDs/URLs identify the same Canvas File and whether editing or replacing that File affects both.
7. Import the *same cartridge* into the same course again. Record page and file counts, whether
   stable pages updated or duplicated, whether asset URLs changed, and whether every image still
   renders.
8. Copy or share the probe module to a second disposable course using the Canvas operation available
   in that environment. Record the operation used, destination Pages/Files placement, stored HTML,
   and rendering of both shared-image pages. Do not report “sharing passed” from a page preview in
   the source course.
9. Export the resulting course as a Canvas course export. Preserve the export and its SHA-256, run
   `unzip -t`, and record the re-exported page paths, stored image references, manifest resource
   shape, Files paths, and count/hash treatment of the shared and duplicate assets.
10. Import that re-export into a third clean course. Record whether all pages, image types, alt text,
    shared references, and duplicate-byte fixtures survive the round trip.

Repeat the winning candidate in a second Canvas environment or release when one is available. If it
is not available, record that limitation explicitly rather than implying cross-version evidence.

## Evidence gate for production

The production exporter must not gain packaged-image behavior until all of the following are true:

- all four generated hashes and worksheet rows are complete;
- raw stored HTML, Files evidence, render evidence, sharing/copy evidence, and the re-export archive
  exist for every variant;
- one manifest/reference strategy passes import, render, reimport, share/copy, re-export, and
  re-export-import without losing alt text or breaking shared assets;
- PNG, JPEG, GIF, and WebP results are stated separately, so a partial media result cannot be treated
  as blanket raster support;
- duplicate-byte handling and final Files placement are recorded rather than inferred;
- the result states whether a second Canvas environment behaved differently; and
- document-import issue 07 records the winning shape and is resolved with the evidence checked in.

If no candidate survives those checks, production asset packaging remains blocked. Do not choose a
shape from the generator tests: those prove cartridge structure and reproducibility, not Canvas
behavior.
