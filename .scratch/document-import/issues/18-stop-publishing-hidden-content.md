# 18 — Stop publishing content the author hid

**What to build:** Decide what this importer does with content a document marks as hidden, and make
every enabled format do that same thing — visibly — rather than silently republishing it.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Where this came from.** Issue 15 found it incidentally while measuring legacy DOC, and recorded it
as out of scope because it is a property of an *enabled* format rather than of the format it was
evaluating. Its design's fact 7 carries the table:

| construct | DOCX | DOC |
| --- | --- | --- |
| deleted text | excluded | published, inline, unmarked |
| inserted text | published | published |
| comment | dropped | dropped |
| **hidden text** | **published** | **published** |

DOC is now disabled, so its column is moot. **DOCX is released**, and on that row it behaves the
same way: text the author marked hidden reaches the imported page with no finding.

**Why it is not merely a formatting question.** An author hides a row, a column, or a run because
they do not want a reader to see it — an unredacted name, an internal note, a salary figure, a draft
sentence. Republishing it into a Canvas page publishes it to a class. Issue 16 measured the same
mechanism in the other direction and it is not hypothetical: an ODS file's hidden sheet, hidden row
and hidden column all reached the imported HTML, carrying a name and a salary figure, while the
*same source* saved as `.xlsx` dropped all three. Two sibling formats already disagree.

**The decision is the deliverable, not the guard.** "Drop it silently" and "publish it with a
warning" are both defensible and they are not the same product. What is not defensible is the
current state, where the answer differs per format for no stated reason and no user is told either
way.

- [ ] Every enabled format is measured for what it does with hidden text, hidden rows/columns, and hidden sections, against fixtures written by a real producer rather than synthesized.
- [ ] One policy is chosen and written down with its reasoning — dropped, or imported with a finding that names it — and it is the same policy for every enabled format.
- [ ] The chosen policy is enforced by a test per enabled format, so a format cannot drift back.
- [ ] Whatever the policy, the user can tell from the import that hidden content existed; silence is not an outcome.
- [ ] `PRIVACY.md` states what happens to hidden content, because a user deciding whether to import a document needs to know before they do it.
- [ ] The capability table's per-format limitations say it too, in the words an instructor reads at the file picker.
