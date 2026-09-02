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
/**
 * T35 — THE TENANCY RULE FOR A TEMPLATE, AND ITS FIX, WRITTEN ONCE.
 *
 * ⚠ THREE SURFACES SAY THIS AND THEY MUST NOT DRIFT: the two CREATE-time
 * refusals in `channel-ops-launch.ts` (one with the tenancy NAMED, one without),
 * and the `no-template` entry in {@link REFUSALS} below — the word the DESKTOP
 * sends back after the operator's machine re-resolved. Three moments about one
 * rule, and three hand-written copies is how two of them end up describing a
 * system the other one does not.
 *
 * ⚠ AUTHORED BY THE P3 TENANCY TIER (`p3/mcp-tenancy-naming`) AND CARRIED HERE
 * VERBATIM — the two strings are byte-identical to that tier's. They lived in
 * `channel-description.ts` until the P1 verbosity tier made that file import
 * {@link DOCTRINE_URI} from this one: this file reaching back for them would
 * close a module cycle, and the cycle's loser is whichever const is read during
 * the other's initialization — a TDZ throw at connect time, not a lint warning.
 * ⚠ SO THEY LIVE ON THE LEAF SIDE. This module imports only the await budget;
 * do not give it an import of `channel-description.ts`.
 */
export declare const TENANCY_RULE = "A template resolves ONLY in the container the channel lives in \u2014 and a home channel IS its own container, so one on your personal shelf or in a standard workspace does not resolve there however visible it is to you.";
export declare const TENANCY_FIX = "Copy it into this channel's container (dopl_agent op=\"copy\", once that op exists) or create it there \u2014 or launch without a template.";
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
 * YOUR OWN AGENTS — the handle, and the three limits on spending it. ⚠ MOVED
 * FROM `SESSION_HANDLE_NOTE`, which rendered under EVERY `read_sessions` page,
 * and from the four-line block `launch_agent` returned on every success. Both
 * now report the FACTS of the call (`launched @agent-x posture=… chain=…`) and
 * point here for the rule.
 *
 * ⚠ EXPORTED AS ITS OWN BLOCK, for the same reason {@link CHANNEL_LAW} is:
 * `channel-session-handle.test.ts` asserts this section never reads as an
 * obstacle with a WORKAROUND, and that scan cannot run over the whole doctrine —
 * the REFUSALS section legitimately says "not something to work around", which
 * is the opposite claim and would trip a whole-text match. Slicing between two
 * headings in the test would re-derive a boundary the source can just state.
 */
export declare const CHANNEL_OWN_AGENTS = "YOUR OWN AGENTS. op=\"launch_agent\" ASKS your operator's own machine to start one; it never reaches another member's, and there is no argument that could name one. SEND A `goal` if you want it to do anything \u2014 a launch WITH one runs that goal as its FIRST INSTRUCTION, and a launch WITHOUT one registers an agent that stands by until something names it, which costs you a second call.\nTHE HANDLE IS `@agent-<id>`, and that `@agent-<id>` form is the only one that means anything outside your operator's own machine \u2014 it is what the Dopl app writes and tints. A friendly NAME your operator gives an agent (op=\"rename_agent\") is stored on that ONE machine, reaches no server, is invisible to every other member, and is never addressable from here \u2014 so \"read_sessions\" keeps printing the id after a rename, and that is correct rather than a stale read.\nTO REDIRECT ONE LATER: WRITING `@agent-<id>` IN A POST BODY WAKES THAT AGENT \u2014 write it in the BODY of a post into its channel, threaded with the same thread id if it has one. That is the ONE case where a handle addresses an agent rather than a person: the token is parsed on your operator's machine, never by the server's mention resolver, so it stamps nobody and lands in no Tags inbox. \u26A0 BEFORE YOU REACH FOR IT: a launch that carried a `goal` is ALREADY WORKING on it, so waking is for agents you need to REDIRECT, not for ones you just started. \u26A0 THREE LIMITS, and they are the fence rather than a knack: (1) it must NAME the agent \u2014 an unaddressed post of yours starts nobody, whatever it says; (2) it works only for YOUR OWN operator's agents, because you post under their account, which is what licenses it; (3) delivery is not observable from here, because the wake happens on a desktop this server cannot see. So treat the post as a REQUEST and watch for the agent's own posts, or its state changing, rather than assuming it woke.\nop=\"direct_agent\" says something to one of them PRIVATELY instead \u2014 nothing is posted anywhere, its answer is private too, and what comes back is the FINAL TEXT OF ONE TURN and nothing else. op=\"end_agent\" stops one: terminal for that session, the thread untouched, every message it posted still attributed, and instance ids are never reused, so there is no undo. \u26A0 AND EVERY SUCCESS MEANS THE MACHINE SAID SO. \"launched\", \"ended\", \"renamed\" and \"delivered\" are that desktop's own report and there is no second source to check them against \u2014 so if nothing appears in \"read_sessions\" and nothing is posted, say that rather than assuming it worked. \u26A0 EVERY ONE OF THESE ASKS AND MAY BE REFUSED \u2014 a refusal is a normal answer from a machine its owner controls, not an error and not a bug in your request. \u26A0 AND IF A WAIT TIMES OUT THE REQUEST IS STILL PENDING: do NOT issue it again. A second launch starts a SECOND agent on the same work and nothing can tell them apart afterwards; a second direction says the same thing to a live agent twice. Look for the outcome in \"read_sessions\" or \"read_directions\" instead.\nop=\"set_agent_mode\" ASKS that a RUNNING agent of yours be given more (or less) room on the tool and/or message axis. \u26A0 YOU ASK, YOU DO NOT SET: your operator's machine NARROWS whatever you name down to the ceiling THEY chose by hand and never widens past it, so asking for \"bypass\" does not give you bypass and no argument, account or phrasing lifts that ceiling. \u26A0 WHETHER YOU WERE NARROWED IS ONLY KNOWN IF THAT MACHINE SAYS SO \u2014 when it says nothing the result prints \"not reported\", which means exactly that and NOT that you got what you asked for. It moves ONE named agent, changes permissions and nothing else, and \u2014 unlike end_agent and rename_agent \u2014 it IS gated by your operator's launch-over-MCP setting, because more room can mean more work run on their hardware.";
/**
 * THE WHOLE TEXT. ⚠ Assembled from the named sections above rather than written
 * as one literal, so a suite can pin a section by name and a reader can see at a
 * glance what the doctrine covers.
 */
export declare const CHANNEL_DOCTRINE: string;
