/**
 * THE DOCTRINE OF THE CHANNELS SURFACE — the standing rules an agent working in
 * a channel has to know, stated ONCE, read ON DEMAND.
 *
 * ⚠ WHY IT EXISTS, AND WHAT IT REPLACED (T10/T11/T12/T13/T82, 2026-09-02). This
 * text used to be shipped THREE ways at once: baked into `CHANNEL_DESCRIPTION`
 * (~35k chars on every connection), repeated in the RESULT of every write
 * (~2.5–3.5k chars per `post`), and repeated again under every `read_sessions`.
 * A measured orchestration run spent ~25 write results × ~3k chars ≈ 70k chars
 * re-reading rules it had already been given twice. The rules did not stop being
 * true; they stopped being worth re-transmitting per call. They live here, and
 * the surfaces POINT at them.
 *
 * ⚠ WHAT MAY LIVE HERE, AND WHAT MAY NOT. This file holds STANDING doctrine —
 * true of the surface, independent of any one call. A REPORT of what a
 * particular call did (which readers the server resolved, whether a post
 * threaded, what a machine refused) is a FACT about that call and belongs in
 * that call's result, terse, where the model reads it at the moment it decides
 * what to do next (INVARIANTS §10). Moving a per-call fact in here hides it;
 * leaving standing doctrine in a result is what this file undoes.
 *
 * ⚠ TWO DOORS, ONE TEXT. It is published as the MCP resource
 * {@link DOCTRINE_URI} (`resources.ts`) and returned by
 * `dopl_channel(op="help")` — because an MCP client that does not read
 * resources would otherwise have no door at all, and two texts would drift.
 *
 * ⚠ `channel-` filename prefix is REQUIRED: the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`channel-law.test.ts`, `law-scan.test.ts`) both read every non-test
 * `channel-*.ts` in this directory, and this file is shipped prose — the surface
 * that teaches HARDEST once a reader opens it.
 */
/** The MCP resource URI this text is published at. ⚠ One spelling, imported. */
export declare const DOCTRINE_URI = "dopl://doctrine/channels";
/**
 * THE POINTER — the ONE line a description or a result spends to say where the
 * rules are. ⚠ It names BOTH doors on purpose: a client that cannot read MCP
 * resources still has the op, and a client that can is spared a tool call.
 */
export declare const DOCTRINE_POINTER = "Rules, protocol and etiquette: dopl_channel(op=\"help\"), or read the MCP resource dopl://doctrine/channels.";
/**
 * THE LAW — the eight rules, verbatim from where they were read on every
 * connection. ⚠ `channel-law.test.ts` pins every load-bearing sentence in this
 * block, caps it at EIGHT bullets and at 2200 characters, and scans it for
 * unconditional claims about another member's agent. Those caps did not move
 * when the text did: the law is the part a reader must be able to hold in their
 * head, and a ninth rule means answering which of these eight stopped being one.
 */
export declare const CHANNEL_LAW = "THE LAW OF THIS ROOM \u2014 read this before anything else:\n- A CHANNEL IS A ROOM OF PEOPLE, and their agents (yours included) talk in it on their behalf. Not every message is work: the people in it talk to EACH OTHER here as well.\n- A MESSAGE IS CHAT OR REQUEST, and that is the whole of addressing. intent=\"chat\" is people talking: it addresses nobody and starts nobody, and it is refused outright if you also pass `to`. Everything else is a REQUEST (the default), and a request is the working message.\n- ADDRESSING A PERSON (to=\"<email or user id>\") IS ASKING FOR THEIR MACHINE. That makes it a REQUEST: it triggers that member's listener, which is what can start their agent. `to` cannot name an agent: you reach a PERSON, and their side decides what runs.\n- THE LOOP BRAKE, AND IT IS ABSOLUTE: an AGENT-authored UNADDRESSED message starts nobody, in a room of two or of ten. Agents do not wake each other by talking, and every post you make is agent-authored. So an untargeted post of YOURS reaches no agent at all.\n- YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY BY NAME. op=\"launch_agent\" starts one and its `goal` runs at once; after that, `@agent-<id>` in a body wakes THAT agent. Never another member's agent, and never without naming one.\n- ACT ON two things: messages in a THREAD you are a party to, and main-room messages addressed to YOU. EVERYTHING ELSE IS AMBIENT CONTEXT \u2014 read it, do not answer it.\n- REPLY WHERE YOU WERE ASKED. Asked in the main room, answer in the main room. Work traffic stays in its thread (thread=\"<id>\"). You MAY also post to the main room unprompted, SPARSELY, when the room itself needs to know something; that is a capability, not a habit, and never a running commentary on work that has a thread.\n- BLOCKED AND NEED A PERSON? Post it \u2014 to=<them>, and say in the body that you are blocked. A blocker on YOUR machine is still yours to take to your own operator, not to them. @-TAG THEM IN THE BODY (`@handle`) whenever a human has to read something: the tag is what puts it in that person's Tags inbox, which is where an operator looks instead of reading every message. Tagging is not addressing and starts no agent.";
/**
 * THE WHOLE TEXT. ⚠ Assembled from the named sections above rather than written
 * as one literal, so a suite can pin a section by name and a reader can see at a
 * glance what the doctrine covers.
 */
export declare const CHANNEL_DOCTRINE: string;
