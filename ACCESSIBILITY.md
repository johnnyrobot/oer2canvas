# Accessibility statement

oer2canvas is designed for WCAG 2.2 Level AA output and for an accessible authoring
workflow. Generated textbook pages also follow the supplied Canvas guide's WCAG 2.1 Level AA
requirements: the General Content Page template, Canvas HTML allowlist, descriptive links,
accessible tables, contrast-safe colors, semantic emphasis, and the 120-character Canvas alt
limit are enforced during compilation. The publication gate withholds output while definite
blockers or unanswered human-review items remain. The app interface is exercised with axe-core
in headless Chromium, including the destination, chapter picker, review, rendered chapter, and
IDEA review states (the category panels, the image search region, and the placement dialog),
in normal and forced-colours modes. The browser-only import forms and the page plan editor they hand off to are exercised
against the same WCAG rules, including keyboard-operable source, metadata, rights, and
confirmation controls. Page plan editing never depends on drag and drop: rename, include or
exclude, split, merge, and move up or down are labelled buttons and fields that name the page they
act on, structural changes are announced in one polite live region, and focus is placed
predictably afterwards (on the new page after a split, on the surviving page after a merge, and
on the pressed control after a move). Excluded pages are marked in text as well as by style.

Automated checks are evidence, not a guarantee. A public-release human review covers the web
app, the installed progressive web app, and a Common Cartridge import after Canvas sanitization.
An independent self-host deployment that enables optional direct push must additionally review
its REST-pushed pages after Canvas sanitization. Instructors should review the final pages in
their Canvas instance,
especially MathML rendering, screen-reader pronunciation, equation context, tables, and
institution-specific styles. Canvas may sanitize or style content differently across versions.
Human review should record the browser, operating system, assistive technology,
Canvas version, output path, and any issues found.

For an accessibility issue in the app, report the screen, browser/assistive technology,
and a minimal reproduction to `johnny@johnnyrobot.ai`. Do not send a Canvas token or a
student record.
