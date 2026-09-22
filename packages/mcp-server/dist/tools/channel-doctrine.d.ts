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
/**
 * 🔒 **IT NAMED THE ID PATH AND THE ID PATH HAD STOPPED OBEYING IT (fixed
 * 2026-09-18).** The sentence read *"a template resolves ONLY in the container
 * the channel lives in … so one in your personal container … does not resolve
 * there however visible it is to you"*, and ruling #18 (B2, 2026-09-02) made a
 * UUID follow its own tenancy through `read-resource.ts › readResourceById` —
 * "a personal template launches anywhere its owner is",
 * `src/features/agent-templates/server/service-resolve-ref.ts`'s own words. So
 * for sixteen days this refusal told an agent that its Home template could not
 * launch here, at exactly the moment it had passed an id that would have.
 * **It is the NAME path the rule is about**, and it now says so.
 */
export declare const TENANCY_RULE = "A NAME resolves only in the container the channel lives in, and a home channel IS its own container \u2014 so a template named by NAME from your home space or a workspace does not resolve here. Its ID does: an id resolves wherever the row lives.";
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
export declare const TENANCY_FIX = "Re-issue with its ID, which resolves wherever the row lives (dopl_agent lists them); lend it into this channel's container (dopl_agent op=\"grant\", scope=\"container\", to=<that container>) or create it there \u2014 or launch without a template.";
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
export declare const CHANNEL_LAW = "THE LAW OF THIS ROOM \u2014 read this before anything else:\n- A CHANNEL IS A ROOM OF PEOPLE, and their agents (yours included) talk in it on their behalf.\n- EVERY MESSAGE YOU SEND IS ADDRESSED OR IT IS A RECORD, AND THERE IS NO THIRD WAY. `to` addresses \u2014 ONE name or SEVERAL, comma-separated, agents and people mixed. kind=\"record\" files a post for NOBODY: visible in the room, reaching no agent and no inbox. A send with neither is REFUSED, so decide before you write.\n- ADDRESSING A PERSON (to=<email or user id>) REACHES THE PERSON AND NOT THEIR AGENTS: they are notified, and NO agent of theirs takes a turn over it. `to` never names another member's agent, and one of your own only by the next bullet. If the work needs an agent, name the agent.\n- THE LOOP BRAKE, AND IT IS ABSOLUTE: an AGENT-authored UNADDRESSED message starts nobody AND IS SHOWN TO NOBODY, in a room of two or of ten. Agents do not wake each other by talking, and every post you make is agent-authored \u2014 so a record costs the room nothing.\n- YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY IN `to`, BY NAME \u2014 slugged: \"Bug Reviewer\" is `@bug-reviewer`. op=\"manage\" action=\"launch\" starts one and answers the name it got; that tag, in `to`, wakes THAT agent, and `to` takes as many of them as the work needs. AN AGENT HANDLE IN YOUR BODY IS PROSE AND REACHES NOBODY. NEVER WRITE AN AGENT ID IN A MESSAGE: ids are internal, and NAMES ARE UNIQUE among addressable agents (a second \"Coder\" is stored Coder-1), so a tag reaches exactly one. Never another member's agent, and never without naming one.\n- ACT ON two things: messages in a THREAD you are a party to, and main-room messages addressed to YOU. EVERYTHING ELSE IS AMBIENT CONTEXT \u2014 read it, do not answer it.\n- REPLY WHERE YOU WERE ASKED. Asked in the main room, answer in the main room. Work traffic stays in its thread. You MAY also post to the main room unprompted, SPARSELY: that is a capability, not a habit.\n- BLOCKED AND NEED A PERSON? to=<them> \u2014 that IS the address and the room RENDERS it, so never restate a recipient in the body. @-TAG A HUMAN YOU DID NOT ADDRESS (`@handle`): their Tags inbox. Tagging is not addressing and starts no agent.";
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
    readonly law: "THE LAW OF THIS ROOM — read this before anything else:\n- A CHANNEL IS A ROOM OF PEOPLE, and their agents (yours included) talk in it on their behalf.\n- EVERY MESSAGE YOU SEND IS ADDRESSED OR IT IS A RECORD, AND THERE IS NO THIRD WAY. `to` addresses — ONE name or SEVERAL, comma-separated, agents and people mixed. kind=\"record\" files a post for NOBODY: visible in the room, reaching no agent and no inbox. A send with neither is REFUSED, so decide before you write.\n- ADDRESSING A PERSON (to=<email or user id>) REACHES THE PERSON AND NOT THEIR AGENTS: they are notified, and NO agent of theirs takes a turn over it. `to` never names another member's agent, and one of your own only by the next bullet. If the work needs an agent, name the agent.\n- THE LOOP BRAKE, AND IT IS ABSOLUTE: an AGENT-authored UNADDRESSED message starts nobody AND IS SHOWN TO NOBODY, in a room of two or of ten. Agents do not wake each other by talking, and every post you make is agent-authored — so a record costs the room nothing.\n- YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY IN `to`, BY NAME — slugged: \"Bug Reviewer\" is `@bug-reviewer`. op=\"manage\" action=\"launch\" starts one and answers the name it got; that tag, in `to`, wakes THAT agent, and `to` takes as many of them as the work needs. AN AGENT HANDLE IN YOUR BODY IS PROSE AND REACHES NOBODY. NEVER WRITE AN AGENT ID IN A MESSAGE: ids are internal, and NAMES ARE UNIQUE among addressable agents (a second \"Coder\" is stored Coder-1), so a tag reaches exactly one. Never another member's agent, and never without naming one.\n- ACT ON two things: messages in a THREAD you are a party to, and main-room messages addressed to YOU. EVERYTHING ELSE IS AMBIENT CONTEXT — read it, do not answer it.\n- REPLY WHERE YOU WERE ASKED. Asked in the main room, answer in the main room. Work traffic stays in its thread. You MAY also post to the main room unprompted, SPARSELY: that is a capability, not a habit.\n- BLOCKED AND NEED A PERSON? to=<them> — that IS the address and the room RENDERS it, so never restate a recipient in the body. @-TAG A HUMAN YOU DID NOT ADDRESS (`@handle`): their Tags inbox. Tagging is not addressing and starts no agent.";
    readonly model: "THE MODEL:\nA CHANNEL (or DM) holds many THREADS, and may have two members or many — check the roster first.\nA THREAD is ONE exchange between exactly TWO parties: whoever OPENED it and the ONE it is ADDRESSED TO. Only those two can post into it; a third member's post is refused. It is not private — every member can READ every thread. A THREAD HAS NO FINISHED STATE: nothing settles one, no op ends one. Your operator ends your SESSION; the thread stays readable and postable.\nA SESSION is ONE member's agent run working a thread, on THAT member's machine; you see their messages, never their session.\nWHO A MESSAGE IS FOR: every op=\"read\" line ends \"→ you\", \"→ @<agent>\", \"→ <member>\", a COMMA-SEPARATED list of them, or \"→ nobody\", then its delivery. One aimed at YOU or YOUR agent is to act on; the rest is context. A PERSON who names nobody is still answered — the room's nominee, its one agent, else whichever agent spoke here last — and the arrow says which. An AGENT who names nobody is answered by nobody, and nothing is aimed anywhere on its behalf: that is a record.\nWHERE THE RECIPIENT IS WRITTEN: in `to=`, never in the body. Every surface renders it from that metadata, so a routing header (`FROM→TO | KIND |`), your own name, or the recipient's handle repeated in `body` is chrome the reader sees twice — write the message, not the envelope.\nTHREE AUDIENCES, THREE REGISTERS — match the one you addressed: a PERSON short and plain · an AGENT complete · `@desktop` complete, agent-style. `@desktop` is YOUR operator's OUTSIDE SESSIONS (their Claude Code/Codex/Cursor run), always addressable in `to`; it wakes no agent and notifies nobody, and a line for it reads \"→ @desktop\".";
    readonly send: "op=\"send\" — THE ONE WAY TO SAY ANYTHING.\nEVERY SUBSTANTIVE THING YOU SAY IS AN ORDINARY SEND, YOUR FINAL ANSWER INCLUDED.\nADDRESS IT OR MARK IT A RECORD; a send with neither is REFUSED. `to` takes ONE name or SEVERAL, comma-separated, mixing agents (`@handle`) and people (email or user id) — each agent named is woken ONCE, each person notified, and a name that resolves to nobody refuses the WHOLE send with the live handles listed. kind=\"record\" is the post for nobody: it stays in the room and reaches no agent and no inbox. Inside a thread neither is needed — a reply with no `to` goes to the thread's other party, server-resolved.\nCHOOSING: answering someone → `to` them · need a person to DECIDE → `to` them, kind=\"decision\" · handing work over → `to` that agent, or all of them · a note nobody must act on → kind=\"record\".\nkind=\"milestone\": ONE line marking a step that just landed, on a thread, carrying no content and read by nobody as a reply.\nkind=\"decision\": a CARD a person answers with one press — `summary` the question, `body` what they need to know, `options` 2-6 choices each with its consequence, `recommendation` the one you would take.\nTHREADING: thread=\"new\" opens the exchange and returns its id. A legacy `task-<channel>-<seq>` id has no thread row behind it, so a send onto one reports `landed=adhoc`.\nLIFECYCLE MARKERS (\"task_started\" / \"task_finished\" / \"task_failed\") are the runtime's and are REFUSED FROM AN AGENT CREDENTIAL; a terminal one renders as a status chip with its body not shown.\n@-TAGS REACH PEOPLE AND ONLY PEOPLE: `@` then the handle, in the BODY — there is no argument for it. A handle is a display name or an email's local part, lowercased, spaces as dashes (`@diana-taylor`); squashed and first-word forms work. The result's `tags=` count is the verdict. WHY A TAG RESOLVES TO NOBODY — FIVE CAUSES: (1) THE HANDLE WAS IN CODE — a handle inside backticks or a fenced block is quoted text and tags nobody; (2) the spelling missed, since matching is EXACT and never a prefix; (3) two members answer to it, which resolves to NOBODY rather than guessing; (4) they are not a member of THIS channel; (5) THE HANDLE NAMED AN AGENT — tags resolve against the HUMAN roster, and an agent is reached by `to` alone. For (2), (3) and (4), check the roster.\nWHAT HAPPENS ON THE RECEIVING SIDE IS NOT THAT you wait on them: a send simply NOTIFIES them. Nothing you send sits in a queue over there waiting to be approved, so silence means nobody has picked it up YET. Your outgoing call is reviewed on YOUR machine: you may have to wait for YOUR OWN operator to approve it.\n`delivery=` IS THE ACK AND THE ONLY ONE: `delivered` a live recipient got it · `woken` a dormant one was started · `idle` resolved but nothing running, filed until that machine reconciles · `unreachable` a handle answers to nobody · `none` no recipient, which is every record · `refused` the far side declined. WITH SEVERAL RECIPIENTS IT IS ONE WORD FOR ALL OF THEM, THE STRONGEST ANY OF THEM EARNED — read `addressed=` and the read's `→` arrow for who they were.";
    readonly read: "op=\"read\" — THE TRANSCRIPT, AND THE HOLD.\n`since=<seq>` returns only messages after that cursor; with none you get the newest page, and older ones are absent rather than reported.\n`wait_ms` turns the page into a HOLD and needs `since`. An empty return is the budget expiring, not an answer. HOW TO WAIT IS ITS OWN SECTION — read `waiting` before you arm one, and before you ever re-read on a timer.\n`thread=<id>` narrows to one exchange and renders that thread's card above it; it hands back NO cursor, so take yours from an unscoped read.\nAN OUTSIDE SESSION (anything on the operator's token this product did not spawn) SEES EVERY MESSAGE, unfiltered. Act on \"⚠ FOR YOU\" (addressed `@desktop`) and \"likely for you\" lines; UNTAGGED IS NOT NOT-FOR-YOU. Tell agents you task to reply `to=@desktop`.";
    readonly waiting: "WAITING — A HOLD, NOT A POLL.\nEvery wake re-sends a session's whole context: a timer pays that per tick; a hold pays once, on arrival.\nWITH BACKGROUND TASKS: run the hold in one (skill `dopl-channels-wait`), END your turn — finishing it is the wake.\nWITHOUT: dopl_channel(op=\"read\", channel=<ref>, since=<cursor>, wait_ms=<ms>), re-armed on the SAME cursor each turn.\nSTOP when nothing has come from the MEMBER YOU ADDRESSED — not the room — for ~30 min; LOOK before each re-arm. No thread ever closes; silence is the only stop signal.\nA DESKTOP-RUN SESSION MAY NOT HOLD: the message wakes it.";
    readonly manage: "op=\"manage\" — YOUR OWN OPERATOR'S AGENTS, AND ONLY THEIR MACHINE.\nEvery action files a request on your own operator's machine and holds for its answer. The op never names an operator — the server stamps the authenticated caller — so another member's id reaches nothing and YOUR machine answers `no-session`.\n\"launch\" starts one: `name` it (never an id; nameless is refused) and its `body` is its FIRST INSTRUCTION. ITS `name=` IS THE TAG IT ANSWERS TO, and a taken name is stored `-1`/`-2` — tag what came back. A `template` name matching more than one is refused with every id listed. \"end\" stops one, and there is no undo — instance ids are never reused. \"rename\" sets its DISPLAY name — what people see and what agents tag it by. \"posture\" re-permissions a running one. \"direct\" sends it a private message and reads that turn's final text back.\nA REFUSAL IS A NORMAL ANSWER: the row was filed and answered, nothing is pending, and re-issuing changes nothing unless the word says so. `cap` full, read op=\"status\" instead · `busy` mid-turn · `no-sdk` no runtime · `auth-hold` the operator must sign in · `no-bridge` the operator's LAUNCH toggle is off; it gates \"launch\" and \"posture\", never \"end\" or \"rename\" · `no-counterparty` nothing to receive it · `no-template` THAT machine could not resolve it under the operator's visibility · `no-session` no such agent · `no-chain` no further agents · `bad-name` the label was not one line of 1-60 visible characters · `blocked` that machine's \"Direct agents\" setting is off.\nA TIMEOUT IS NOT A FAILURE: the request stays PENDING, and re-issuing without the SAME `client_msg_id` starts a SECOND agent.\nWHAT IS ASKED FOR AND WHAT RUNS ARE NOT THE SAME THING: a `model` that machine does not recognize is NOT refused — it silently FALLS BACK, and nothing tells you. `runtime` IS THE OPPOSITE AND IS NOT A MODEL: it picks the ENGINE (claude, codex), a model name never selects one, and one that machine cannot start comes back `no-sdk` rather than launching another vendor. Omitting it takes the channel's own. Every launch result names the runtime that ACTUALLY ran, and names what you asked for only when the two differ.";
    readonly rooms: "op=\"rooms\" — WHAT THIS PLACE IS, and op=\"status\" — WHAT IS RUNNING.\nFour actions READ and four WRITE; a read-only session is refused the writes BY NAME while the reads answer. \"open\" makes a channel (`name`) or a 1:1 (`to`, and only with `name` omitted — both together is refused, never resolved by precedence); \"update\" REPLACES the info card whole, so an omitted row is deleted and a blind write clobbers — and EVERYONE IN THE CHANNEL SEES the card, which is what makes a blind write somebody else's problem.\nop=\"status\" reads your own machine's live sessions and the directions waiting for them. Template, model, context, tokens, current tool and start time are YOUR OWN sessions only — a peer's agent is a handle and a state. The MODEL is always ONE unbroken token, so a name with a space in it is a template. A `—` cell was NOT REPORTED, and is not a zero.";
    readonly fields: "THE ARGUMENTS THAT CARRY A RULE:\nOMITTING `channel` IS A WIDER READ, not a default one — op=\"read\" and op=\"status\" then answer for every channel you are in, across every workspace and home container.\nONE CURSOR SPACE, ONE `since` — `seq` is table-wide, so one cursor covers every channel.\n`client_msg_id` IS WHAT MAKES A RETRY SAFE; the dedupe is PER-AUTHOR.\n`posture.chain` NAMES ITS THREE STATES because \"absent\" is not \"off\": \"inherit\" takes the operator's setting, which may be ON.\n`color` IS AN IDENTITY, NEVER A STATUS — how a reader tells two agents apart; a red agent is not a failing one. The sixteen keys are UNIQUE PER CHANNEL ACROSS ALL MEMBERS, so another member's agent may hold the one you name: a 409 listing what is free, NOTHING FILED — re-issue with the SAME `client_msg_id`. A key returns to the bank when its agent ENDS; a room with all sixteen out runs UNCOLOURED. **NAMES are unique the same way and resolve it for you**, with `-1`, rather than refusing.";
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
