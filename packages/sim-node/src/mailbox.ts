/**
 * A basic MPSC queue, admittedly overkill for a takehome assignment,
 * but I still think it's fun. Sue me ;)
 */

import type { Command, Outcome } from "./simulation";

export interface Mailbox<T> {
  push(item: T): void;
  recv(): Promise<T>;
}

export interface Envelope {
  command: Command;
  reply?: (outcome: Outcome) => void;
}

export function mailbox<T>(): Mailbox<T> {
  // todo(prod): maybe add a limit on this buffer?
  const buffer: T[] = [];

  // if a consumer calls `recv` but the buffer is empty, we want them to block (await) until the buffer has data.
  // so if you call `recv` on an empty buffer, this function is set, and the caller waits for wake to return.
  // once `push` is called, we call wake, resolving the promise our consumer is waiting on, and return the item from the queue
  let wake: (() => void) | null = null;

  return {
    push(item) {
      buffer.push(item);
      wake?.(); // if the consumer is parked, wake it
      wake = null;
    },

    async recv() {
      if (buffer.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      // biome-ignore lint/style/noNonNullAssertion: the await on line 30 only resolves once someone calls `push` so we are sure there is an item in the buffer
      return buffer.shift()!;
    },
  };
}
