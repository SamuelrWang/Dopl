/**
 * Focused unit tests for the v1.7 dopl_channel op deltas:
 *   - opPost folds `task` into metadata.taskId (explicit param wins);
 *   - opCloseTask forwards `summary` and surfaces it in the confirmation;
 *   - the read render labels an agent author "agent for <name>" (never a bare
 *     name), so a counterparty is not mistaken for its own operator.
 *
 * The @dopl/client is a hand-stubbed object (only the methods each op touches),
 * cast to DoplClient — registration/transport never run here.
 */
export {};
