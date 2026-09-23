import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opLaunchAgent } from "./channel-ops-launch";
export declare const CHANNEL: {
    id: string;
    slug: string;
    name: string;
    visibility: string;
};
/** The full channel row, for suites driven through `registerChannelTool`. */
export declare const CHANNEL_ROW: {
    workspaceId: string;
    topic: string;
    visibility: "private";
    createdBy: string;
    archivedAt: null;
    createdAt: string;
    updatedAt: string;
    id: string;
    slug: string;
    name: string;
};
export declare const AGENT = "a1b2c3d4";
export declare const DIRECTIVE_ID = "55555555-5555-5555-5555-555555555555";
/** A pending launch row; the fields it omits stay absent, as on an older server's row. */
export declare function directive(over?: Partial<LaunchDirective>): LaunchDirective;
export declare const launched: (over?: Partial<LaunchDirective>) => LaunchDirective;
/** A pending `end` row aimed at {@link AGENT}; pass `kind` for another verb. */
export declare const agentDirective: (over?: Partial<LaunchDirective>) => LaunchDirective;
/** A pending `set_agent_mode` row: every posture column present, the echo columns null. */
export declare const modeDirective: (over?: Partial<LaunchDirective>) => LaunchDirective;
export declare function launchClient(over?: Record<string, unknown>): DoplClient;
/** A client whose launch create already answers with this row (no poll needed). */
export declare const created: (over: Partial<LaunchDirective>) => DoplClient;
/** A client whose launch create stays pending and whose poll answers with this row. */
export declare const polls: (over: Partial<LaunchDirective>) => DoplClient;
export declare function agentClient(over?: Record<string, unknown>): DoplClient;
/** A client whose agent-op create answers with a settled row, so no hold runs. */
export declare const settled: (over: Partial<LaunchDirective>, row?: (over?: Partial<LaunchDirective>) => LaunchDirective) => DoplClient;
export declare const settledMode: (over: Partial<LaunchDirective>) => DoplClient;
export declare const endText: (c: DoplClient) => Promise<string>;
export declare const renameText: (c: DoplClient, name?: string) => Promise<string>;
export declare const launchText: (c: DoplClient, opts?: Parameters<typeof opLaunchAgent>[2]) => Promise<string>;
/** `dopl_channel` args for a launch through the dispatcher. */
export declare const LAUNCH: {
    op: string;
    action: string;
    channel: string;
    name: string;
    body: string;
    wait_ms: number;
};
