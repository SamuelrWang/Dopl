/**
 * Who a task names: `to=` parsed into the route's actor refs, and an actor rendered back as the
 * handle `to=` takes, so a task result always hands a value the next call can pass.
 */
import type { DoplClient, TaskActor, TaskActorRef } from "@dopl/client";
import { type MemberView } from "./channel-render-identity";
import { type ToolResponse } from "./respond";
/** Every comma-separated token of `to`, against the channel's roster, read at most once. */
export declare function resolveTaskActors(client: DoplClient, channelId: string, channel: string, to: string): Promise<TaskActorRef[] | ToolResponse>;
/** Exactly one actor, for the actions that name one. */
export declare function resolveTaskActor(client: DoplClient, channelId: string, channel: string, to: string): Promise<TaskActorRef | ToolResponse>;
/** The roster view actor handles render through; read only when a person is shown. */
export declare function taskMemberView(client: DoplClient, channelId: string, actors: TaskActor[]): Promise<MemberView>;
/** An actor as the handle `to=` takes: `@agent-<id>`, a member's unique plain `@handle`, else their user id. */
export declare function actorHandle(actor: TaskActor | null, view: MemberView): string;
