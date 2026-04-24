import { EventEmitter } from "events";

export interface ProgressEvent {
  type:
    | "info"
    | "step_start"
    | "step_complete"
    | "step_error"
    | "detail"
    | "complete"
    | "error";
  message: string;
  step?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Singleton event emitter for streaming ingestion progress to SSE clients.
 * Each entry ID gets its own event channel.
 */
class IngestionProgress {
  private emitters = new Map<string, EventEmitter>();
  // Buffer recent events so late-connecting clients can catch up
  private eventBuffers = new Map<string, ProgressEvent[]>();
  private static MAX_BUFFER_SIZE = 200;

  emit(
    entryId: string,
    type: ProgressEvent["type"],
    message: string,
    extra?: { step?: string; details?: Record<string, unknown> }
  ): void {
    const event: ProgressEvent = {
      type,
      message,
      step: extra?.step,
      details: extra?.details,
      timestamp: new Date().toISOString(),
    };

    // Buffer the event
    if (!this.eventBuffers.has(entryId)) {
      this.eventBuffers.set(entryId, []);
    }
    const buffer = this.eventBuffers.get(entryId)!;
    buffer.push(event);
    if (buffer.length > IngestionProgress.MAX_BUFFER_SIZE) {
      buffer.shift();
    }

    // Emit to any connected listeners
    const emitter = this.emitters.get(entryId);
    if (emitter) {
      emitter.emit("progress", event);
    }

    // Auto-cleanup on terminal events
    if (type === "complete" || type === "error") {
      // Give SSE clients a moment to receive the final event before cleanup
      setTimeout(() => this.cleanup(entryId), 30_000);
    }
  }

  /**
   * Subscribe to progress events for an entry.
   * Returns a ReadableStream suitable for SSE responses.
   * Replays buffered events first, then streams live events.
   */
  subscribe(entryId: string): ReadableStream<Uint8Array> {
    if (!this.emitters.has(entryId)) {
      this.emitters.set(entryId, new EventEmitter());
    }
    const emitter = this.emitters.get(entryId)!;
    const bufferedEvents = this.eventBuffers.get(entryId) || [];

    const encoder = new TextEncoder();

    return new ReadableStream({
      start(controller) {
        // Replay buffered events for late-connecting clients
        for (const event of bufferedEvents) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }

        // Check if already terminal
        const lastEvent = bufferedEvents[bufferedEvents.length - 1];
        if (
          lastEvent &&
          (lastEvent.type === "complete" || lastEvent.type === "error")
        ) {
          controller.close();
          return;
        }

        // Stream live events
        const onProgress = (event: ProgressEvent) => {
          try {
            const data = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(data));

            if (event.type === "complete" || event.type === "error") {
              controller.close();
            }
          } catch {
            // Stream was closed by client
            emitter.removeListener("progress", onProgress);
          }
        };

        // Keepalive ping every 15 seconds
        const keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            clearInterval(keepalive);
            emitter.removeListener("progress", onProgress);
          }
        }, 15_000);

        emitter.on("progress", onProgress);

        // Cleanup when pipeline ends
        emitter.once("cleanup", () => {
          clearInterval(keepalive);
          emitter.removeListener("progress", onProgress);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });
      },

      cancel() {
        // Client disconnected
      },
    });
  }

  /**
   * Check if an entry has any buffered events (i.e., ingestion was started).
   */
  hasEntry(entryId: string): boolean {
    return this.eventBuffers.has(entryId);
  }

  private cleanup(entryId: string): void {
    const emitter = this.emitters.get(entryId);
    if (emitter) {
      emitter.emit("cleanup");
      emitter.removeAllListeners();
    }
    this.emitters.delete(entryId);
    this.eventBuffers.delete(entryId);
  }
}

// Singleton instance
export const ingestionProgress = new IngestionProgress();
