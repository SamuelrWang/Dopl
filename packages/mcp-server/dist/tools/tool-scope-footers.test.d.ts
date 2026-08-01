/**
 * THE RESULT-SIDE HALF of the completeness sweep: a filtered listing must say
 * so ON THE RESULT, not only in a description the calling agent may never have
 * read closely.
 *
 * WHY BOTH HALVES. `tool-scope-claims.test.ts` pins the descriptions. A
 * description is read once, at connection time, ahead of every tool in the set;
 * a RESULT is read at the moment the agent forms the belief. The incident this
 * sweep exists for happened in the second place: two agents compared "6 skills"
 * against "1 skill" and neither output carried a word about why they could
 * differ. The footers below are what they would have hit.
 *
 * THE RULE EVERY LINE HERE OBEYS — and it is what the tests actually check:
 * a footer states the FILTER, never a count it would need a second query to
 * obtain. "Drafts are not listed" is free. "4 skills were hidden from you" is a
 * round trip on every list call, which is a worse tool than the one it fixes.
 * So `dopl_ontology(op="resolve")` and `dopl_search` DO print "showing N of M"
 * — both numbers are already in memory, the cap is applied locally — while
 * `dopl_skill(op="list")` and `dopl_kb(op="list_bases")` name the filter only.
 *
 * Driven through the real registrars with the shared harness from
 * `narration-fixtures.ts`; the @dopl/client is hand-stubbed and nothing
 * transports.
 */
export {};
