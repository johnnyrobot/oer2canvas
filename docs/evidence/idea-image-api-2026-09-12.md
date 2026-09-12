# IDEA image APIs — browser-direct probe — 2026-09-12

Origin under test: http://127.0.0.1:57841. Query: "students studying". No key sent.

| Endpoint | Search from page script | Hits |
| --- | --- | --- |
| Wikimedia Commons | HTTP 200 | 4 |
| Openverse (anonymous) | opaque/failed: TimeoutError: signal timed out | 0 |

Openverse, 3 attempts in sequence: opaque/failed: TimeoutError: signal timed out; opaque/failed: TimeoutError: signal timed out; opaque/failed: TimeoutError: signal timed out.

| Image host | Bytes fetch from page script |
| --- | --- |
| thumb.wikimedia.org | HTTP 200, 19399 bytes |
| upload.wikimedia.org | HTTP 200, 1935309 bytes |
| thumb.wikimedia.org | HTTP 200, 26429 bytes |
| upload.wikimedia.org | HTTP 200, 422123 bytes |

Reproduce with `npm run verify:idea-image-api`. A provider whose search is opaque is not offered; an image host whose bytes are opaque cannot be packaged, and the placement dialog says so for that hit.
