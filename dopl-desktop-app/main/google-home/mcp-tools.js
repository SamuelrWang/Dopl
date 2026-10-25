// The Google Home MCP tools. Names follow the glasses set (`glasses_status`, `glasses_capabilities`,
// `glasses_notify`, `glasses_show`) with the device in the prefix, so an agent that knows one device
// knows the other. There is no `google_home_ask`: Cast cannot carry an answer back, and
// `google_home_capabilities` says so rather than offering a tool that would never return one.
// Result shape matches the glasses tools: one JSON text block, `isError` on a refusal.

const { z } = require('zod');
const { GoogleHomeError, LIMITS: L } = require('./service');

const TOOL_NAMES = ['google_home_status', 'google_home_capabilities', 'google_home_notify', 'google_home_show'];

const errorResult = (text) => ({ content: [{ type: 'text', text }], isError: true });

async function runTool(fn) {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await fn()) }] };
  } catch (err) {
    if (err instanceof GoogleHomeError) return errorResult(err.message);
    return errorResult(`google home tool failed: ${err && err.message ? err.message : String(err)}`);
  }
}

const device = z.string().optional().describe('Device id or name from google_home_status. Omit when there is one.');

/** Register the four tools on an `McpServer` against one `createGoogleHome()` instance. */
function registerGoogleHomeTools(server, home) {
  server.registerTool(
    'google_home_status',
    {
      title: 'google_home_status',
      description: 'Google Home / Nest speakers and displays on this network: {online, count, devices:[{id, name, model, display, group}]}. Rescans (about 3s).',
      inputSchema: z.object({}),
    },
    () => runTool(() => home.status({ refresh: true })),
  );

  server.registerTool(
    'google_home_capabilities',
    {
      title: 'google_home_capabilities',
      description: 'What Google Home can do through Dopl and its limits. ask is not supported. Read once.',
      inputSchema: z.object({}),
    },
    () => runTool(async () => home.capabilities()),
  );

  server.registerTool(
    'google_home_notify',
    {
      title: 'google_home_notify',
      description: `Say a short message out loud on a Google Home / Nest speaker. text <=${L.text} chars. Interrupts whatever is playing.`,
      inputSchema: z.object({
        text: z.string().optional().describe('What to say. Required unless audio_url is given.'),
        device,
        voice: z.string().optional().describe('A macOS voice name (e.g. "Samantha"). Default: the system voice.'),
        audio_url: z.string().optional().describe('Play this http(s) audio instead of speaking text.'),
        content_type: z.string().optional().describe('MIME type of audio_url (default audio/mpeg).'),
      }),
    },
    (args) => runTool(() => home.notify(args)),
  );

  server.registerTool(
    'google_home_show',
    {
      title: 'google_home_show',
      description: `Show a card on a Nest Hub (a device with display:true). title <=${L.title} chars, 0-${L.lines} lines of <=${L.line}. speak:true also reads it aloud.`,
      inputSchema: z.object({
        title: z.string(),
        lines: z.array(z.string()).optional(),
        device,
        speak: z.boolean().optional().describe('Also read the card aloud (default false).'),
        voice: z.string().optional(),
        image_url: z.string().optional().describe('Show this http(s) image (PNG/JPEG, <=1280x720) instead of the rendered card.'),
      }),
    },
    (args) => runTool(() => home.show(args)),
  );
}

module.exports = { registerGoogleHomeTools, TOOL_NAMES };
