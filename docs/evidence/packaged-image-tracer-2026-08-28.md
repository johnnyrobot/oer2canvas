# Packaged-image tracer acceptance — 2026-08-28

Evidence for document-import issue 08's final criterion: a cartridge produced by the real pipeline
imports into a live Canvas and renders its packaged image.

Reproduce with:

```sh
npx vitest run --project browser src/import/packaged-cartridge.browser.test.ts  # builds the artifact
npm run verify:canvas-image-tracer                                              # imports it to Canvas
```

## Result

```
PASS 1 packaged image(s) rendered with alt text intact
```

The cartridge is built by the production path with nothing stubbed — the anydoc Worker parses a DOCX
fixture carrying an embedded PNG, the chapter is compiled and passed through the accessibility gate,
and `buildCartridge` writes the archive. The browser test refuses to emit an artifact unless the
gated HTML actually contains a `$IMS-CC-FILEBASE$/oer2canvas/` reference, so a meaningless artifact
cannot be produced silently.

## The artifact

2,818 bytes, five entries, `unzip -t` clean:

```
imsmanifest.xml
course_settings/canvas_export.txt
course_settings/module_meta.xml
wiki_content/biology-handout-biology-handout.html
web_resources/oer2canvas/image1-b81de774.png
```

The page carries the reference the gate approved, byte for byte:

```html
<img src="$IMS-CC-FILEBASE$/oer2canvas/image1-b81de774.png" alt="Cell diagram" width="16" height="16">
```

and the manifest declares the asset in the shape issue 07 measured as the only one that both works
and survives a re-export:

```xml
<resource identifier="asset-image1-b81de774.png" type="webcontent" href="web_resources/oer2canvas/image1-b81de774.png">
  <file href="web_resources/oer2canvas/image1-b81de774.png"/>
</resource>
```

## What Canvas did with it

Import completed with **zero migration issues**. Canvas rewrote the token to an absolute course-file
URL and preserved the alt text and dimensions:

```
stored src:  https://<canvas>/courses/<id>/files/<fileId>/preview
stored alt:  "Cell diagram"
files:       image1-b81de774.png @ course files/oer2canvas
```

The Files placement confirms issue 07's finding in production: Canvas strips the `web_resources/`
prefix, so `web_resources/oer2canvas/<name>` becomes `course files/oer2canvas/<name>`. Production
must not assume the packaged path is the Canvas Files path.

The rendered page screenshot (`artifacts/packaged-image-tracer/`, gitignored and reproducible) shows
the 16×16 raster displayed in the imported page.

## A false negative this run caught

The first live run failed with `no images rendered` while the import had in fact succeeded. The fault
was in the measurement, not the feature: `renderPages` sized its wait from a page map keyed to issue
07's four probe pages, so for any other page the expected count fell to zero, the wait condition
became vacuously true, and the DOM was read before Canvas painted.

It now derives the expected count from the page's own stored HTML, which is general to any cartridge.
Recording it because a harness that reports failure when the product works is as damaging as one that
reports success when it does not — and this one did so while looking entirely plausible.

## Limitations

- **One Canvas environment**, the same self-hosted instance as issue 07. Not cross-version evidence.
- **One image, one format.** This is a tracer: a single 16×16 PNG in a DOCX. The offline suite covers
  PNG/JPEG/GIF/WebP across DOCX/EPUB/ODT/RTF, but only this one path is proven against live Canvas.
- **Redaction.** The Canvas hostname and course ids are replaced above; nothing else is altered.
