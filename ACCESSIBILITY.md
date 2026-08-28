# Accessibility statement

oer2canvas is designed for WCAG 2.2 Level AA output and for an accessible authoring
workflow. Generated textbook pages also follow the supplied Canvas guide's WCAG 2.1 Level AA
requirements: the General Content Page template, Canvas HTML allowlist, descriptive links,
accessible tables, contrast-safe colors, semantic emphasis, and the 120-character Canvas alt
limit are enforced during compilation. The publication gate withholds output while definite
blockers or unanswered human-review items remain. The app interface is exercised with axe-core
in headless Chromium, including the destination, chapter picker, review, and rendered chapter
states. The browser-only plain-text authoring form and its escaped preview are exercised against
the same WCAG rules, including keyboard-operable source, metadata, rights, preview, and
confirmation controls.

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
