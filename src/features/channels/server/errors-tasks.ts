import { ChannelError } from "./errors-base";

/** Unknown here and in another channel are one answer, so ids are not probeable across rooms. */
export class TaskNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Task not found: ${ref}`);
  }
}

export class SubtaskNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Subtask not found: ${ref}`);
  }
}

/** An assignee or owner that is neither a member of this channel nor an agent live in it. */
export class TaskActorUnresolvedError extends ChannelError {
  constructor(public readonly actor: string) {
    super(`No member of this channel or agent live in it matches ${actor}`);
  }
}

export class TaskLinkUnresolvedError extends ChannelError {
  constructor(public readonly link: string) {
    super(`No ${link} in this channel to link the task to`);
  }
}

export class TaskLimitError extends ChannelError {
  constructor(what: string, max: number) {
    super(`A task holds at most ${max} ${what}`);
  }
}
