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
