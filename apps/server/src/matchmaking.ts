import type { UserProfile } from "./types.js";

/**
 * FIFO matchmaking queue, Omegle-style: the first two users waiting are
 * paired together regardless of language (translation handles the rest).
 * In-memory by design for the MVP; swap for Redis when scaling out.
 */
export class MatchmakingQueue {
  private queue: UserProfile[] = [];

  /**
   * Adds a user to the queue. If someone else is already waiting, both are
   * removed and returned as a pair [earlier, newcomer].
   */
  join(user: UserProfile): [UserProfile, UserProfile] | null {
    this.remove(user.socketId);
    const partner = this.queue.shift();
    if (partner) {
      return [partner, user];
    }
    this.queue.push(user);
    return null;
  }

  remove(socketId: string): void {
    this.queue = this.queue.filter((u) => u.socketId !== socketId);
  }

  has(socketId: string): boolean {
    return this.queue.some((u) => u.socketId === socketId);
  }

  get size(): number {
    return this.queue.length;
  }
}
