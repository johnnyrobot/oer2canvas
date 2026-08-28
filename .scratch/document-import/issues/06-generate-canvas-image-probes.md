# 06 — Generate deterministic Canvas embedded-image probe cartridges

**What to build:** Produce small reproducible Canvas cartridges that isolate the unresolved choices for packaged images, along with a repeatable procedure for observing how Canvas imports, stores, renders, shares, and re-exports those assets.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Probe variants cover candidate manifest layouts and app-generated `$IMS-CC-FILEBASE$` references.
- [ ] Fixtures include a single image, one shared image referenced by multiple pages, duplicate image bytes, and representative candidate raster types.
- [ ] Every probe is deterministic and passes structural cartridge validation before being tested in Canvas.
- [ ] A validation worksheet records import success, stored page HTML, rendered image behavior, Files placement, sharing behavior, and re-export behavior.
- [ ] The procedure clearly identifies which evidence is required before the production exporter may change.
- [ ] Probe generation does not alter the production cartridge path.
