# Fixture images

The eight images referenced by `../page.json` and `../page-section.json`, fetched
from `https://openstax.org/apps/archive/20260604.144757/resources/<sha1>` on
2026-08-21. Each file is named by the sha1 of its own bytes, which is how
OpenStax names them and is also where the compliance queue gets its dedupe hash
without fetching anything.

They are committed because absolutization means the audit iframe now really does
load images, and no test in this suite may touch the network. `<img>` elements in
both fixtures carry `width`/`height`, so the used box comes from the attributes
and the audited layout does not depend on the bytes — but the real files also
give slice 9's S1 VLM benchmark something honest to run against.

From *Algebra and Trigonometry* by Jay Abramson et al., OpenStax,
<https://openstax.org/books/algebra-and-trigonometry>, licensed under the
Creative Commons Attribution License,
<http://creativecommons.org/licenses/by/4.0/>.
