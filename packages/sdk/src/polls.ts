import type { PollDefinition } from "./client/types.js";

/** Shared authoring limits; the contract repeats these checks authoritatively. */
export function validatePoll(poll: PollDefinition, now = Date.now()): void {
  if (!poll.question.trim() || poll.question.length > 500) throw new Error("Ask a question of 1–500 characters.");
  if (poll.options.length < 2 || poll.options.length > 8) throw new Error("Provide 2–8 answers.");
  if (poll.options.some(o => !o.trim() || o.length > 120)) throw new Error("Each answer must contain 1–120 characters.");
  if (new Set(poll.options.map(o => o.trim().toLowerCase())).size !== poll.options.length) throw new Error("Each answer must be different.");
  if (!/^\d+$/.test(poll.closes_at)) throw new Error("Choose a valid closing time.");
  const closes = BigInt(poll.closes_at);
  if (closes < BigInt(now + 300000) || closes > BigInt(now + 2592000000)) throw new Error("Polls must close in 5 minutes to 30 days.");
}
