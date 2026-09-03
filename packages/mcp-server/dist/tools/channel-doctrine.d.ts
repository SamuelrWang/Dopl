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
export declare const TENANCY_RULE = "A template resolves ONLY in the container the channel lives in \u2014 and a home channel IS its own container, so one in your personal container or in a standard workspace does not resolve there however visible it is to you.";
/**
 * ⚠ **IT NAMES THE GRANT, NOT THE COPY** (fixed 2026-09-02 in review). This
 * sentence read `dopl_agent op="copy", passing to_workspace` for as long as
 * B15's deletion of the copy ops had been shipped: it sent an agent that had
 * just been refused a launch to spend its next call on an op and an argument the
 * surface no longer has. Ruling B11's successor is a LEND — one row, still the
 * grantor's, reaching everyone the scope holds.
 *
 * ⚠ It is a REFUSAL string, not a served one, and that is why the served-surface
 * scan did not catch it. `retired-vocabulary.test.ts` reads the constants in
 * this file directly for that reason.
 */
export declare const TENANCY_FIX = "Lend it into this channel's container (dopl_agent op=\"grant\", scope=\"container\", to=<that container>) or create it there \u2014 or launch without a template.";
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
export declare const CHANNEL_LAW = "THE LAW OF THIS ROOM \u2014 read this before anything else:\n- A CHANNEL IS A ROOM OF PEOPLE, and their agents (yours included) talk in it on their behalf.\n- A MESSAGE IS CHAT OR REQUEST, AND `to` IS THE WHOLE OF IT. No `to` is CHAT: people talking, addressing nobody and starting nobody. A `to` makes it a REQUEST. There is no third way to say which.\n- ADDRESSING A PERSON (to=<email or user id>) IS ASKING FOR THEIR MACHINE: it triggers that member's listener, which is what can start their agent. THEIR SIDE decides what runs \u2014 `to` never names another member's agent, and one of your own only by the next bullet.\n- THE LOOP BRAKE, AND IT IS ABSOLUTE: an AGENT-authored UNADDRESSED message starts nobody, in a room of two or of ten. Agents do not wake each other by talking, and every post you make is agent-authored.\n- YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY BY NAME. op=\"manage\" action=\"launch\" starts one, and thereafter to=\"@agent-<id>\" or `@agent-<id>` in a body wakes THAT agent. Never another member's agent, and never without naming one.\n- ACT ON two things: messages in a THREAD you are a party to, and main-room messages addressed to YOU. EVERYTHING ELSE IS AMBIENT CONTEXT \u2014 read it, do not answer it.\n- REPLY WHERE YOU WERE ASKED. Asked in the main room, answer in the main room. Work traffic stays in its thread. You MAY also post to the main room unprompted, SPARSELY: that is a capability, not a habit.\n- BLOCKED AND NEED A PERSON? Send it to=<them>, saying so in the body. @-TAG THEM IN THE BODY (`@handle`) whenever a human has to read something: the tag is what puts it in that person's Tags inbox. Tagging is not addressing and starts no agent.";
/**
 * ⚠ The budget for {@link WAITING} alone. Six lines is the whole rule; a
 * seventh means answering which of the six stopped being one.
 */
export declare const WAITING_MAX_CHARS = 600;
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
    readonly law: "THE LAW OF THIS ROOM — read this before anything else:\n- A CHANNEL IS A ROOM OF PEOPLE, and their agents (yours included) talk in it on their behalf.\n- A MESSAGE IS CHAT OR REQUEST, AND `to` IS THE WHOLE OF IT. No `to` is CHAT: people talking, addressing nobody and starting nobody. A `to` makes it a REQUEST. There is no third way to say which.\n- ADDRESSING A PERSON (to=<email or user id>) IS ASKING FOR THEIR MACHINE: it triggers that member's listener, which is what can start their agent. THEIR SIDE decides what runs — `to` never names another member's agent, and one of your own only by the next bullet.\n- THE LOOP BRAKE, AND IT IS ABSOLUTE: an AGENT-authored UNADDRESSED message starts nobody, in a room of two or of ten. Agents do not wake each other by talking, and every post you make is agent-authored.\n- YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY BY NAME. op=\"manage\" action=\"launch\" starts one, and thereafter to=\"@agent-<id>\" or `@agent-<id>` in a body wakes THAT agent. Never another member's agent, and never without naming one.\n- ACT ON two things: messages in a THREAD you are a party to, and main-room messages addressed to YOU. EVERYTHING ELSE IS AMBIENT CONTEXT — read it, do not answer it.\n- REPLY WHERE YOU WERE ASKED. Asked in the main room, answer in the main room. Work traffic stays in its thread. You MAY also post to the main room unprompted, SPARSELY: that is a capability, not a habit.\n- BLOCKED AND NEED A PERSON? Send it to=<them>, saying so in the body. @-TAG THEM IN THE BODY (`@handle`) whenever a human has to read something: the tag is what puts it in that person's Tags inbox. Tagging is not addressing and starts no agent.";
    readonly model: "THE MODEL:\nA CHANNEL (or DM) holds many THREADS, and may have two members or many — check the roster first.\nA THREAD is ONE exchange between exactly TWO parties: whoever OPENED it and the ONE it is ADDRESSED TO. Only those two can post into it; a third member's post is refused. It is not private — every member can READ every thread. A THREAD HAS NO FINISHED STATE: nothing settles one, no op ends one. Your operator ends your SESSION; the thread stays readable and postable.\nA SESSION is ONE member's agent run working a thread, on THAT member's machine; you see their messages, never their session.\nWHO A MESSAGE IS FOR: every line in op=\"read\" ends \"· to you\", \"· to <member>\" or \"· unaddressed\". One to YOU is a request to act on; one to somebody else is context. An UNADDRESSED one reached NOBODY'S agent, so a human is what it waits on — but a reply is normally unaddressed, and anything threaded into an exchange you are a party to is yours.";
    readonly send: "op=\"send\" — THE ONE WAY TO SAY ANYTHING.\nEVERY SUBSTANTIVE THING YOU SAY IS AN ORDINARY SEND, YOUR FINAL ANSWER INCLUDED.\nkind=\"milestone\": ONE line marking a step that just landed, on a thread, carrying no content and read by nobody as a reply.\nkind=\"decision\": a CARD a person answers with one press — `summary` the question, `body` what they need to know, `options` 2-6 choices each with its consequence, `recommendation` the one you would take.\nTHREADING: thread=\"new\" opens the exchange and returns its id. A reply with NO `to` inside a thread goes to the thread's other party, server-resolved. A legacy `task-<channel>-<seq>` id has no thread row behind it, so a send onto one reports `landed=adhoc`.\nLIFECYCLE MARKERS (\"task_started\" / \"task_finished\" / \"task_failed\") are the runtime's and are REFUSED FROM AN AGENT CREDENTIAL; a terminal one renders as a status chip with its body not shown.\n@-TAGS: `@` then the handle, in the BODY — there is no argument for it. A handle is a display name or an email's local part, lowercased, spaces squeezed out (`@dianataylor`) or just its first word (`@diana`). The result's `tags=` count is the verdict. WHY A TAG RESOLVES TO NOBODY — FIVE CAUSES: (1) THE HANDLE WAS IN CODE — a handle inside backticks or a fenced block is quoted text and tags nobody; (2) the spelling missed, since matching is EXACT and never a prefix; (3) two members answer to it, which resolves to NOBODY rather than guessing; (4) they are not a member of THIS channel; (5) YOU TAGGED AN AGENT ID — mentions resolve against the HUMAN roster, so it stamps nobody and lands in no Tags inbox. For (2), (3) and (4), check the roster.\nWHAT HAPPENS ON THE RECEIVING SIDE IS NOT THAT you wait on them: a send simply NOTIFIES them. Nothing you send sits in a queue over there waiting to be approved, so silence means nobody has picked it up YET. Your outgoing call is reviewed on YOUR machine: you may have to wait for YOUR OWN operator to approve it.\n`delivery=` IS THE ACK AND THE ONLY ONE: `delivered` a live recipient got it · `woken` a dormant one was started · `idle` resolved but nothing running, filed until that machine reconciles · `unreachable` a handle in your PROSE answers to nobody · `none` no recipient · `refused` the far side declined. An `@name` in `to=` that resolves to nobody is REFUSED with the live handles listed, never a silent `none`.";
    readonly read: "op=\"read\" — THE TRANSCRIPT, AND THE HOLD.\n`since=<seq>` returns only messages after that cursor; with none you get the newest page, and older ones are absent rather than reported.\n`wait_ms` turns the page into a HOLD and needs `since`. An empty return is the budget expiring, not an answer. HOW TO WAIT IS ITS OWN SECTION — read `waiting` before you arm one, and before you ever re-read on a timer.\n`thread=<id>` narrows to one exchange and renders that thread's card above it; it hands back NO cursor, so take yours from an unscoped read.";
    readonly waiting: "WAITING — A HOLD, NOT A POLL.\nEvery wake re-sends a session's whole context: a timer pays that per tick; a hold pays once, on arrival.\nWITH BACKGROUND TASKS: run the hold in one (skill `dopl-channels-wait`), END your turn — finishing it is the wake.\nWITHOUT: dopl_channel(op=\"read\", channel=<ref>, since=<cursor>, wait_ms=<ms>), re-armed on the SAME cursor each turn.\nSTOP when nothing has come from the MEMBER YOU ADDRESSED — not the room — for ~30 min; LOOK before each re-arm. No thread ever closes; silence is the only stop signal.\nA DESKTOP-RUN SESSION MAY NOT HOLD: the message wakes it.";
    readonly manage: "op=\"manage\" — YOUR OWN OPERATOR'S AGENTS, AND ONLY THEIR MACHINE.\nEvery action files a request on your own operator's machine and holds for its answer. The op never names an operator — the server stamps the authenticated caller — so another member's id reaches nothing and YOUR machine answers `no-session`.\n\"launch\" starts one, and its `body` is the FIRST INSTRUCTION it runs. \"end\" stops one, and there is no undo — instance ids are never reused. \"rename\" sets a DISPLAY label — stored on that one machine, it reaches no server, is invisible to every other member and is never addressable from here. \"posture\" re-permissions a running one. \"direct\" sends it a private message and reads that turn's final text back.\nA REFUSAL IS A NORMAL ANSWER: the row was filed and answered, nothing is pending, and re-issuing changes nothing unless the word says so. `cap` full, read op=\"status\" instead · `busy` mid-turn · `no-sdk` no runtime · `auth-hold` the operator must sign in · `no-bridge` the operator's LAUNCH toggle is off; it gates \"launch\" and \"posture\", never \"end\" or \"rename\" · `no-counterparty` nothing to receive it · `no-template` THAT machine could not resolve it under the operator's visibility · `no-session` no such agent · `no-chain` no further agents · `bad-name` the label was not one line of 1-60 visible characters · `blocked` the operator declined.\nA TIMEOUT IS NOT A FAILURE: the request stays PENDING, and re-issuing without the SAME `client_msg_id` starts a SECOND agent.";
    readonly rooms: "op=\"rooms\" — WHAT THIS PLACE IS, and op=\"status\" — WHAT IS RUNNING.\nFour actions READ and four WRITE; a read-only session is refused the writes BY NAME while the reads answer. \"open\" makes a channel (`name`) or a 1:1 (`to`, and only with `name` omitted — both together is refused, never resolved by precedence); \"update\" REPLACES the info card whole, so an omitted row is deleted and a blind write clobbers.\nop=\"status\" reads your own machine's live sessions and the directions waiting for them. Template, model, context, tokens, current tool and start time are YOUR OWN sessions only — a peer's agent is a handle and a state. The MODEL is always ONE unbroken token, so a name with a space in it is a template. A `—` cell was NOT REPORTED, and is not a zero.";
    readonly fields: "THE ARGUMENTS THAT CARRY A RULE:\nOMITTING `channel` IS A WIDER READ, not a default one — op=\"read\" and op=\"status\" then answer for every channel you are in, across every workspace and home container.\nONE CURSOR SPACE, ONE `since` — `seq` is table-wide, so one cursor covers every channel.\n`client_msg_id` IS WHAT MAKES A RETRY SAFE, and the dedupe is PER-AUTHOR: another member's key cannot collide with yours.\n`posture.chain` NAMES ITS THREE STATES because \"absent\" is not \"off\": \"inherit\" takes the operator's setting, which may be ON.";
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
