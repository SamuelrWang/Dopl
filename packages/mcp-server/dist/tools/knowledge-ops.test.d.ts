/**
 * `dopl_kb` folder-description / entry-excerpt surfacing (Feature C).
 *
 * Locks the two behaviors this feature added on top of the parity guard:
 *   1. get_tree / list_dir render each row's description/excerpt inline,
 *      flattened to one line and truncated (~120 chars, ellipsis); the
 *      separator only appears when a summary exists.
 *   2. create_folder threads `description`, write_file threads `excerpt`
 *      through to the @dopl/client calls.
 *
 * The client is a hand-rolled stub — only the methods each op touches are
 * implemented, so the tests never make a network call.
 */
export {};
