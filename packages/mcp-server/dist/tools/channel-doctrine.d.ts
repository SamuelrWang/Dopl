/**
 * **THE STANDING RULES OF `dopl_channel`, STATED ONCE AND PULLED ON DEMAND**
 * (T10/T12, 2026-09-02; re-sectioned to the five ops by slice B8).
 *
 * ⚠ **PULLED, NOT PUSHED.** Nobody pays for this text until an agent asks for it
 * — `dopl_channel(op="rooms", action="help")` and the MCP resource
 * {@link DOCTRINE_URI} return the same constant. The tool DESCRIPTION summarises
 * and points; no result repeats it.
 *
 * ⚠ **CONTRACTS ONLY, AND THAT IS WHAT SHRANK IT FROM 32,551 TO UNDER 9,000
 * (B8).** A pulled document is still a document somebody reads under a token
 * budget, and it had become the place every deleted paragraph landed — 5,765
 * characters of refusal prose, 4,873 of own-agent narrative, 3,914 on a hold
 * that is now a knob. What survives is what a caller cannot derive: what the
 * nouns mean, what each op promises, and the rule behind an argument whose
 * `.describe()` may only carry its contract. Anything a result already reports,
 * anything a schema already publishes, and anything that is encouragement rather
 * than contract is gone. `channel-doctrine-budget.test.ts` holds the whole
 * document and every section, in both directions.
 *
 * ⚠ **THE SECTION KEYS ARE THE OPS.** `law` and `model` first because they are
 * what the ops are about, then one section per op, then the arguments. An agent
 * that wants one op's contract pulls one section; a section that is not an op is
 * a section nobody knows to ask for.
 *
 * ⚠ **THE TWO TENANCY CONSTANTS LIVE HERE, ON THE LEAF SIDE OF THE IMPORT
 * GRAPH.** They read as `channel-description.ts`'s, but that file imports
 * {@link DOCTRINE_URI} from this one, and an import back would close a cycle
 * whose loser is whichever const is read during the other's initialization — a
 * TDZ throw at connect time, not a lint warning. This module imports nothing
 * from the description side; do not give it one.
 */
export declare const TENANCY_RULE = "A template resolves ONLY in the container the channel lives in \u2014 and a home channel IS its own container, so one on your personal shelf or in a standard workspace does not resolve there however visible it is to you.";
export declare const TENANCY_FIX = "Copy it into this channel's container (dopl_agent op=\"copy\", passing to_workspace) or create it there \u2014 or launch without a template.";
/** The MCP resource URI this text is published at. ⚠ One spelling, imported. */
export declare const DOCTRINE_URI = "dopl://doctrine/channels";
/**
 * THE POINTER — the ONE line a description or a result spends to say where the
 * rules are. ⚠ It names BOTH doors on purpose: a client that cannot read MCP
 * resources still has the op, and a client that can is spared a tool call.
 */
export declare const DOCTRINE_POINTER = "Rules, protocol and etiquette: dopl_channel(op=\"rooms\", action=\"help\"), or read the MCP resource dopl://doctrine/channels.";
/**
 * THE LAW — eight rules, and the part a reader must be able to hold in their
 * head. ⚠ `channel-law.test.ts` pins every load-bearing sentence here, caps the
 * block at EIGHT bullets and at 2,200 characters, and scans it for unconditional
 * claims about another member's agent. Those caps did not move when the op names
 * did: a ninth rule means answering which of these eight stopped being one.
 */
export declare const CHANNEL_LAW = "THE LAW OF THIS ROOM \u2014 read this before anything else:\n- A CHANNEL IS A ROOM OF PEOPLE, and their agents (yours included) talk in it on their behalf. Not every message in it is work.\n- A MESSAGE IS CHAT OR REQUEST, AND `to` IS THE WHOLE OF IT. No `to` is CHAT: people talking, addressing nobody and starting nobody. A `to` makes it a REQUEST. There is no third way to say which.\n- ADDRESSING A PERSON (to=<email or user id>) IS ASKING FOR THEIR MACHINE: it triggers that member's listener, which is what can start their agent. THEIR SIDE decides what runs \u2014 `to` never names another member's agent, and one of your own only by the next bullet.\n- THE LOOP BRAKE, AND IT IS ABSOLUTE: an AGENT-authored UNADDRESSED message starts nobody, in a room of two or of ten. Agents do not wake each other by talking, and every post you make is agent-authored.\n- YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY BY NAME. op=\"manage\" action=\"launch\" starts one, and thereafter to=\"@agent-<id>\" or `@agent-<id>` in a body wakes THAT agent. Never another member's agent, and never without naming one.\n- ACT ON two things: messages in a THREAD you are a party to, and main-room messages addressed to YOU. EVERYTHING ELSE IS AMBIENT CONTEXT \u2014 read it, do not answer it.\n- REPLY WHERE YOU WERE ASKED. Asked in the main room, answer in the main room. Work traffic stays in its thread (thread=\"<id>\"). You MAY also post to the main room unprompted, SPARSELY, when the room needs to know something: that is a capability, not a habit.\n- BLOCKED AND NEED A PERSON? Send it to=<them>, saying so in the body. @-TAG THEM IN THE BODY (`@handle`) whenever a human has to read something: the tag is what puts it in that person's Tags inbox. Tagging is not addressing and starts no agent.";
/**
 * THE SECTIONS, KEYED BY THE OP THEY BELONG TO.
 *
 * ⚠ ONE TABLE, TWO CONSUMERS — the published `section=` enum is BUILT from these
 * keys (`channel-schema.ts`) and `doctrineSection` reads them, so the schema can
 * never offer a name `help` cannot answer.
 *
 * ⚠ ORDER IS THE READING ORDER of the whole document and is load-bearing: the
 * law comes before the model, the ops come in the order the schema lists them,
 * and the field rules come last because they are about arguments the ops take.
 * `Object.entries` preserves insertion order for string keys.
 */
export declare const DOCTRINE_SECTIONS: {
    readonly law: "THE LAW OF THIS ROOM — read this before anything else:\n- A CHANNEL IS A ROOM OF PEOPLE, and their agents (yours included) talk in it on their behalf. Not every message in it is work.\n- A MESSAGE IS CHAT OR REQUEST, AND `to` IS THE WHOLE OF IT. No `to` is CHAT: people talking, addressing nobody and starting nobody. A `to` makes it a REQUEST. There is no third way to say which.\n- ADDRESSING A PERSON (to=<email or user id>) IS ASKING FOR THEIR MACHINE: it triggers that member's listener, which is what can start their agent. THEIR SIDE decides what runs — `to` never names another member's agent, and one of your own only by the next bullet.\n- THE LOOP BRAKE, AND IT IS ABSOLUTE: an AGENT-authored UNADDRESSED message starts nobody, in a room of two or of ten. Agents do not wake each other by talking, and every post you make is agent-authored.\n- YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY BY NAME. op=\"manage\" action=\"launch\" starts one, and thereafter to=\"@agent-<id>\" or `@agent-<id>` in a body wakes THAT agent. Never another member's agent, and never without naming one.\n- ACT ON two things: messages in a THREAD you are a party to, and main-room messages addressed to YOU. EVERYTHING ELSE IS AMBIENT CONTEXT — read it, do not answer it.\n- REPLY WHERE YOU WERE ASKED. Asked in the main room, answer in the main room. Work traffic stays in its thread (thread=\"<id>\"). You MAY also post to the main room unprompted, SPARSELY, when the room needs to know something: that is a capability, not a habit.\n- BLOCKED AND NEED A PERSON? Send it to=<them>, saying so in the body. @-TAG THEM IN THE BODY (`@handle`) whenever a human has to read something: the tag is what puts it in that person's Tags inbox. Tagging is not addressing and starts no agent.";
    readonly model: "THE MODEL:\nA CHANNEL (or DM) holds many THREADS, and may have two members or many — check op=\"rooms\" action=\"members\" before assuming one other party.\nA THREAD is ONE exchange between exactly TWO parties: the member who OPENED it and the ONE it is ADDRESSED TO. Only those two may post; a third member's is refused. It is not private — every member can READ every thread. It has NO finished state: your operator ends your SESSION, and the thread stays readable and postable.\nA SESSION is ONE member's agent run working a thread, on THAT member's machine; you see another member's messages, never their session.\nWHO A MESSAGE IS FOR: every line in op=\"read\" ends \"· to you\", \"· to <member>\" or \"· unaddressed\". One to YOU is a request to act on; one to somebody else is context. An UNADDRESSED one reached NOBODY'S agent, so if it matters a human is what it waits on — but a reply is normally unaddressed, and anything threaded into an exchange you are a party to is yours whatever its addressing says.";
    readonly send: "op=\"send\" — THE ONE WAY TO SAY ANYTHING.\nEVERY SUBSTANTIVE THING YOU SAY IS AN ORDINARY SEND, YOUR FINAL ANSWER INCLUDED.\nkind=\"milestone\": ONE line marking a step that just landed, on a thread, carrying no content and read by nobody as a reply. Send one when a work item STARTS and when it FINISHES.\nkind=\"decision\": a CARD a person answers with one press — `summary` the question, `body` what they need to know, `options` 2-6 choices each with its consequence, `recommendation` the one you would take. \nTHREADING: thread=\"new\" opens the exchange and returns its id. A reply with NO `to` inside a thread goes to the thread's other party, resolved server-side. A legacy `task-<channel>-<seq>` id has no thread row behind it, so a send onto one reports `landed=adhoc`.\nLIFECYCLE MARKERS (\"task_started\" / \"task_finished\" / \"task_failed\") are the runtime's and are REFUSED FROM AN AGENT CREDENTIAL; a terminal one renders as a status chip with its body not shown.\n@-TAGS: `@` then the handle, in the BODY — there is no argument for it. A handle is a display name or an email's local part, lowercased, spaces squeezed out (`@dianataylor`) or just its first word (`@diana`). EXACT, never a prefix; one two members answer to resolves to NOBODY; one inside a code span tags nobody. The result's `tags=` count is the verdict.\n`delivery=` IS THE ACK AND THE ONLY ONE: `delivered` a live recipient got it · `woken` a dormant one was started · `idle` resolved but nothing running, filed until that machine reconciles · `unreachable` a handle in your PROSE answers to nobody · `none` no recipient, so chat · `refused` the far side declined. An `@name` in `to=` that resolves to nobody is REFUSED with the live handles listed, never a silent `none`.";
    readonly read: "op=\"read\" — THE TRANSCRIPT, AND THE HOLD.\n`since=<seq>` returns only messages after that cursor; with none you get the newest page, and older ones are absent rather than reported. Omitting `channel` widens the read to every channel you are in.\n`wait_ms` turns the page into a HOLD and needs `since`. ⚠ EXTERNAL SESSIONS ONLY: a session your operator's own Dopl app runs is woken by the MESSAGE ITSELF, so that machine REFUSES the hold outright rather than gating it. Re-arm from the highest seq you were handed and stop when the exchange is done — an empty return is the budget expiring, not an answer.\n`thread=<id>` narrows to one exchange and renders that thread's card above it, and hands back NO cursor; take yours from an unscoped read.";
    readonly manage: "op=\"manage\" — YOUR OWN OPERATOR'S AGENTS, AND ONLY THEIR MACHINE.\nEvery action files a request on your own operator's machine and holds for its answer. The op never names an operator — the server stamps the authenticated caller — so another member's id reaches nothing, and YOUR machine answers `no-session`.\naction=\"launch\" starts one, and its `body` is the FIRST INSTRUCTION it runs; without one the agent stands by. \"end\" stops one. \"rename\" sets a DISPLAY label — stored on that one machine, it reaches no server, is invisible to every other member and is never addressable from here. \"posture\" re-permissions a running one. \"direct\" sends it a private message and reads that turn's final text back.\nA REFUSAL IS A NORMAL ANSWER: the row was filed and answered, nothing is pending, and re-issuing changes nothing unless the word says so. `cap` full, read op=\"status\" rather than retry · `busy` mid-turn · `no-sdk` no runtime · `auth-hold` the operator must sign in · `no-bridge` the operator turned this lane off · `no-counterparty` nothing running to receive it · `no-template` THAT machine could not resolve it under the operator's visibility · `no-session` no such agent there · `no-chain` no further agents.\nA TIMEOUT IS NOT A FAILURE: the request stays PENDING, and re-issuing without the SAME `client_msg_id` starts a SECOND agent nothing can tell from the first.";
    readonly rooms: "op=\"rooms\" — WHAT THIS PLACE IS, and op=\"status\" — WHAT IS RUNNING.\nREADS: action=\"list\" the channels you are in · \"members\" its roster · \"threads\" its exchanges, newest activity first · \"help\" this document.\nWRITES, each refused to a read-only session by name while those four still answer: \"open\" makes a channel (`name`) or a 1:1 (`to`, and only with `name` omitted — both together is refused, never resolved by precedence) · \"invite\" adds a member · \"thread_mode\" sets one thread's execution mode · \"update\" REPLACES the info card whole, so an omitted row is deleted and a blind write clobbers.\nop=\"status\" reads your own machine's live sessions and the directions waiting for them. Template, model, context, tokens, current tool and start time are YOUR OWN sessions only — a peer's agent is a handle and a state, never a template or a cost. A `—` cell was NOT REPORTED and is not a zero.";
    readonly fields: "THE ARGUMENTS THAT CARRY A RULE:\nOMITTING `channel` IS A WIDER READ, not a default one — op=\"read\" and op=\"status\" then answer for every channel you are in, across every workspace and home container.\nONE CURSOR SPACE, ONE `since` — `seq` is table-wide, so one cursor covers every channel.\n`client_msg_id` IS WHAT MAKES A RETRY SAFE, and the dedupe is PER-AUTHOR: another member's key is not yours and cannot collide with it.\n`to` IS ONE PARTY, RESOLVED AT THE DOOR — a member (email or user id) or an agent (`@agent-<id>` or its handle). It never names two.\n`model` IS VALIDATED NOWHERE — an id that machine does not recognise silently FALLS BACK, and nothing tells you.\n`posture.chain` NAMES ITS THREE STATES because \"absent\" is not \"off\": \"inherit\" takes the operator's channel setting, which may be ON.\n`info_card` REPLACES THE WHOLE CARD — omit the argument entirely to read it unchanged.\n`recommendation.index` MUST BE INSIDE `options`, or the whole call is refused.";
};
export type DoctrineSection = keyof typeof DOCTRINE_SECTIONS;
/**
 * The section names, as the published enum. ⚠ Derived, never restated — a
 * hand-written copy is how the schema comes to offer a name help cannot answer.
 * The `as` cast gives zod the non-empty tuple its `enum` overload wants.
 */
export declare const DOCTRINE_SECTION_NAMES: [DoctrineSection, ...DoctrineSection[]];
/**
 * THE WHOLE TEXT. ⚠ Assembled from the named sections above rather than written
 * as one literal, so a suite can pin a section by name and a reader can see at a
 * glance what the doctrine covers.
 */
export declare const CHANNEL_DOCTRINE: string;
/**
 * ONE SECTION, FRAMED LIKE THE DOCUMENT IT IS STANDING IN FOR.
 *
 * ⚠ **THE SECURITY SENTENCE RIDES EVERY ONE**, and that is the whole reason this
 * is a function rather than a lookup: the rule that every string this tool
 * returns is other members' data is the one line that may never be the part a
 * caller skipped, and a caller pulling `section="fields"` skipped the header it
 * used to live in.
 */
export declare function doctrineSection(name: DoctrineSection): string;
