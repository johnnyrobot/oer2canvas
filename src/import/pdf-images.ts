/**
 * Image bytes out of a PDF, which the extraction module cannot give us.
 *
 * `@firecrawl/pdf-inspector-wasm` returns text and says an image was present; its
 * `PdfProcessResult` has no byte-bearing field at all, and `includeImages` only
 * toggles whether a PLACEHOLDER appears in the Markdown. That is the whole
 * reason PDF figures reached Canvas as "[Embedded image: Figure on page N]"
 * while DOCX figures arrived as pictures — not anything about PDFs, just a limit
 * of one library that had been treated as the end of the story.
 *
 * pdf.js can read the image XObjects directly, so this module exists to do only
 * that: bytes in, raster bytes out, one entry per drawn image with the page it
 * was drawn on. Everything downstream — sniffing, size and pixel caps, content
 * hashing, `$IMS-CC-FILEBASE$` packaging, the alt-text queue, the local vision
 * model — already exists and is what carries DOCX images today.
 *
 * WHAT THIS CANNOT DO, and it is not a bug to be filed: a chart drawn with
 * vector operators is not an image inside the PDF. It is drawing instructions,
 * and there is nothing to extract. Recovering those means rasterising page
 * regions, which is a different feature with different tradeoffs.
 */
import { PARSER_PROBE_LIMITS } from './parser-limit-values'

/** One drawn raster, in the order the page painted it. */
export interface PdfExtractedImage {
  /** 1-indexed, matching every other page number in the PDF importer. */
  page: number
  /** Position among the images drawn on THIS page, 0-indexed. */
  order: number
  mediaType: string
  data: Uint8Array
  width: number
  height: number
}

/**
 * Re-encoding quality for images with no transparency.
 *
 * The source images in a real textbook are already JPEG — 21 of them in the
 * Pressbooks anthropology export, between 4KB and 229KB. pdf.js hands back
 * DECODED pixels rather than the original stream, so something has to re-encode
 * them, and PNG would turn a 20KB photograph into a several-hundred-KB archive
 * entry and walk the cartridge into `maximumAssetBytes` for no visible gain.
 * PNG is still used where there is an alpha channel, because JPEG cannot carry
 * one and a logo would acquire a black box.
 */
const JPEG_QUALITY = 0.85

interface PdfJsImage {
  width: number
  height: number
  bitmap?: ImageBitmap
  data?: Uint8Array | Uint8ClampedArray
  /** pdf.js reports 3 for RGB and 4 for RGBA on raw-data images. */
  numComps?: number
  kind?: number
}

/**
 * Paint the decoded image onto a canvas and read it back as a file format.
 *
 * Two shapes arrive from pdf.js depending on the source encoding and the
 * browser: an `ImageBitmap` (the common path for `/DCTDecode`, and what a real
 * Pressbooks export produces), or raw component bytes. Both are handled because
 * relying on one and crashing on the other would make image recovery depend on
 * which compressor the publisher happened to use.
 */
async function encode(image: PdfJsImage): Promise<{ data: Uint8Array; mediaType: string } | undefined> {
  const { width, height } = image
  if (!width || !height) return undefined
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) return undefined

  let hasAlpha = false
  if (image.bitmap) {
    context.drawImage(image.bitmap, 0, 0)
    // An ImageBitmap carries its own alpha; read one pass to find out whether it
    // is actually used, rather than paying PNG's size for every photograph.
    const sample = context.getImageData(0, 0, width, height).data
    for (let index = 3; index < sample.length; index += 4) {
      if (sample[index] !== 255) { hasAlpha = true; break }
    }
  } else if (image.data) {
    const source = image.data
    const components = image.numComps ?? Math.round(source.length / (width * height))
    if (components !== 1 && components !== 3 && components !== 4) return undefined
    hasAlpha = components === 4
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const at = pixel * components
      const to = pixel * 4
      if (components === 1) {
        const grey = source[at] ?? 0
        rgba[to] = grey; rgba[to + 1] = grey; rgba[to + 2] = grey; rgba[to + 3] = 255
      } else {
        rgba[to] = source[at] ?? 0
        rgba[to + 1] = source[at + 1] ?? 0
        rgba[to + 2] = source[at + 2] ?? 0
        rgba[to + 3] = components === 4 ? (source[at + 3] ?? 255) : 255
      }
    }
    context.putImageData(new ImageData(rgba, width, height), 0, 0)
  } else {
    return undefined
  }

  const mediaType = hasAlpha ? 'image/png' : 'image/jpeg'
  const blob = await canvas.convertToBlob(
    hasAlpha ? { type: mediaType } : { type: mediaType, quality: JPEG_QUALITY },
  )
  return { data: new Uint8Array(await blob.arrayBuffer()), mediaType }
}

/**
 * Every raster drawn in the document, in page then paint order.
 *
 * Bounded by `maximumAssetCount` here as well as in `prepareAssets`, because the
 * decode itself costs memory: refusing the 401st image after decoding it is a
 * worse deal than never decoding it.
 */
export async function extractPdfImages(
  bytes: ArrayBuffer,
  options: { signal?: AbortSignal } = {},
): Promise<PdfExtractedImage[]> {
  options.signal?.throwIfAborted()
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString()

  const found: PdfExtractedImage[] = []
  // `data` is transferred and detached by pdf.js, so hand it a copy: the caller
  // still needs these bytes for hashing and for the extraction probe.
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) })
  const doc = await loading.promise
  try {
    for (let page = 1; page <= doc.numPages; page += 1) {
      options.signal?.throwIfAborted()
      if (found.length >= PARSER_PROBE_LIMITS.maximumAssetCount) break
      const rendered = await doc.getPage(page)
      const operators = await rendered.getOperatorList()
      let order = 0
      for (const [index, fn] of operators.fnArray.entries()) {
        // `paintImageXObject` only. pdf.js 6 removed the separate
        // `paintJpegXObject` op and routes JPEG through this one — measured
        // against a real Pressbooks export, it finds all 21 `/DCTDecode`
        // figures. Comparing against the removed name would be a condition that
        // can never be true, which typechecking caught before it could rot.
        if (fn !== pdfjs.OPS.paintImageXObject) continue
        if (found.length >= PARSER_PROBE_LIMITS.maximumAssetCount) break
        const name = operators.argsArray[index]?.[0]
        if (typeof name !== 'string') continue
        /*
         * `page.objs.get` throws for an object the page references but never
         * resolved. One unreadable image must not cost the other twenty, so
         * every failure here is skipped rather than propagated — the figure
         * warning downstream still reports it as not imported, which is exactly
         * what it is.
         */
        let image: PdfJsImage | undefined
        try {
          image = await new Promise<PdfJsImage>((resolve, reject) => {
            try { rendered.objs.get(name, resolve) } catch (error) { reject(error) }
          })
        } catch { continue }
        if (!image) continue
        let encoded: { data: Uint8Array; mediaType: string } | undefined
        try { encoded = await encode(image) } catch { continue }
        if (!encoded) continue
        found.push({
          page,
          order,
          mediaType: encoded.mediaType,
          data: encoded.data,
          width: image.width,
          height: image.height,
        })
        order += 1
      }
      rendered.cleanup()
    }
  } finally {
    // On the LOADING TASK, not the document proxy: pdf.js 6 moved it, and
    // calling the missing method threw from `finally`, which swallowed both the
    // extracted images and any real error underneath.
    await loading.destroy()
  }
  return found
}
