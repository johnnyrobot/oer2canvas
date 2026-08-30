/*
 * The opted-in web-extraction build.
 *
 * Runs ONLY in the `unit-self-hosted` Vitest project, whose `define` pins
 * `__OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__`. Everything here is about what
 * the build switch DECIDES; the extractor's own behaviour is tested without any
 * switch at all in `src/import/self-hosted-extractor.test.ts`.
 */

test('the build switch really is on in this project', () => {
  /*
   * First assertion in the file, for the reason the forced-colors suite opens
   * the same way: a suite that quietly measured the public configuration would
   * pass every assertion below and prove nothing at all.
   */
  expect(__OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__).toBe('https://extract.example.edu')
})
