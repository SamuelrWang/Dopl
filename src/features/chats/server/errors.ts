export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ChatNotFoundError extends ChatError {
  constructor(public readonly chatId: string) {
    super(`Chat not found: ${chatId}`);
  }
}

export class ChatForbiddenError extends ChatError {
  constructor(action: string) {
    super(`Only the chat's owner can ${action}`);
  }
}

/**
 * Detail read of a chat whose session date falls outside the free-plan
 * retention window. The chat is hidden, NEVER deleted — the route turns
 * this into the friendly `chat_outside_retention` upgrade envelope.
 */
export class ChatOutsideRetentionError extends ChatError {
  constructor(public readonly chatId: string) {
    super(`Chat is outside the retention window: ${chatId}`);
  }
}

export class ChatFolderNotFoundError extends ChatError {
  constructor(public readonly ref: string) {
    super(`Chat folder not found: ${ref}`);
  }
}

export class ChatFolderConflictError extends ChatError {
  constructor(name: string) {
    super(`A folder named "${name}" already exists`);
  }
}

/** Direct share change on a filed chat — sharing follows the folder. */
export class ChatFolderScopeError extends ChatError {
  constructor(folderName: string) {
    super(
      `This chat is in the folder "${folderName}" and inherits its sharing — change the folder's sharing or unfile the chat first`
    );
  }
}
