/**
 * A basic MPSC queue, admittedly overkill for a takehome assignment,
 * but I still think it's fun. Sue me ;)
 */

import type { Command } from "@pendulum/shared/src/types";
import type { Outcome } from "./simulation";

export interface Mailbox {
  push(item: Envelope): void;
  recv(): Promise<Envelope>;
}

export interface Envelope {
  command: Command;
  reply?: (outcome: Outcome) => void;
}

export function mailbox(): Mailbox {
  // ticks are the high-frequency, lowest-priority traffic. anything else is a control command
  // todo(prod): maybe add a limit on these buffers?
  const commands: Envelope[] = [];
  const ticks: Envelope[] = [];

  // if the consumer calls `recv` but both buffers are empty, we want them to block (await) until data arrives.
  // so if you call `recv` on empty buffers, this function is set, and the caller waits for wake to return.
  // once `push` is called, we call wake, resolving the promise our consumer is waiting on, and return the next item.
  let wake: (() => void) | null = null;

  return {
    push(item) {
      // route ticks to their own low-priority buffer, everything else is a control command
      if (item.command.type === "tick") {
        ticks.push(item);
      } else {
        commands.push(item);
      }
      wake?.(); // if the consumer is parked, wake it
      wake = null;
    },

    async recv() {
      if (commands.length === 0 && ticks.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      // control commands take priority: only fall back to a tick when no command is queued.
      // biome-ignore lint/style/noNonNullAssertion: the await above only resolves once someone calls `push`, so at least one buffer is non-empty here
      return commands.length > 0 ? commands.shift()! : ticks.shift()!;
    },
  };
}
