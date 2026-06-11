import { describe, expect, it } from "vitest";
import { MatchmakingQueue } from "./matchmaking.js";
import type { UserProfile } from "./types.js";

const user = (id: string, language = "en"): UserProfile => ({
  socketId: id,
  nickname: `user-${id}`,
  language,
});

describe("MatchmakingQueue", () => {
  it("queues the first user and pairs the second", () => {
    const q = new MatchmakingQueue();
    expect(q.join(user("a", "it"))).toBeNull();
    expect(q.size).toBe(1);

    const pair = q.join(user("b", "en"));
    expect(pair).not.toBeNull();
    expect(pair![0].socketId).toBe("a");
    expect(pair![1].socketId).toBe("b");
    expect(q.size).toBe(0);
  });

  it("pairs users in FIFO order", () => {
    const q = new MatchmakingQueue();
    q.join(user("a"));
    q.join(user("b")); // pairs a-b
    q.join(user("c"));
    const pair = q.join(user("d"));
    expect(pair![0].socketId).toBe("c");
  });

  it("does not pair a user with themselves on duplicate join", () => {
    const q = new MatchmakingQueue();
    q.join(user("a"));
    const pair = q.join(user("a", "fr"));
    expect(pair).toBeNull();
    expect(q.size).toBe(1);
  });

  it("removes users from the queue", () => {
    const q = new MatchmakingQueue();
    q.join(user("a"));
    q.remove("a");
    expect(q.size).toBe(0);
    expect(q.join(user("b"))).toBeNull();
  });
});
