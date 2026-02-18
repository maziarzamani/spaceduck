import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { RunLock } from "../run-lock";

describe("RunLock", () => {
  let lock: RunLock;

  beforeEach(() => {
    lock = new RunLock();
  });

  it("should acquire and release a lock", async () => {
    const release = await lock.acquire("conv-1");
    expect(lock.isLocked("conv-1")).toBe(true);

    release();
    expect(lock.isLocked("conv-1")).toBe(false);
  });

  it("should allow different conversations concurrently", async () => {
    const r1 = await lock.acquire("conv-1");
    const r2 = await lock.acquire("conv-2");

    expect(lock.isLocked("conv-1")).toBe(true);
    expect(lock.isLocked("conv-2")).toBe(true);

    r1();
    r2();
  });

  it("should serialize access to the same conversation", async () => {
    const order: number[] = [];

    const r1 = await lock.acquire("conv-1");
    order.push(1);

    // Second acquire should wait
    const p2 = lock.acquire("conv-1").then((release) => {
      order.push(2);
      release();
    });

    // Give p2 a chance to start waiting
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1]); // p2 should still be waiting

    r1(); // Release first lock
    await p2; // Now p2 should proceed

    expect(order).toEqual([1, 2]);
  });
});
