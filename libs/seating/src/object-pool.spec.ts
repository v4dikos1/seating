import { describe, expect, it, vi } from 'vitest';
import { ObjectPool } from './object-pool';

describe('ObjectPool', () => {
  it('acquires new objects using factory when pool is empty', () => {
    let count = 0;
    const pool = new ObjectPool(() => ({ id: ++count, active: true }));

    const item1 = pool.acquire();
    const item2 = pool.acquire();

    expect(item1.id).toBe(1);
    expect(item2.id).toBe(2);
    expect(pool.size).toBe(0);
  });

  it('reuses released objects', () => {
    const pool = new ObjectPool(() => ({ value: 42 }));
    const obj1 = pool.acquire();
    pool.release(obj1);

    expect(pool.size).toBe(1);
    const obj2 = pool.acquire();
    expect(obj2).toBe(obj1);
    expect(pool.size).toBe(0);
  });

  it('calls reset function on release if provided', () => {
    const reset = vi.fn((item: { visible: boolean }) => {
      item.visible = false;
    });
    const pool = new ObjectPool(() => ({ visible: true }), reset);

    const obj = pool.acquire();
    expect(obj.visible).toBe(true);

    pool.release(obj);
    expect(reset).toHaveBeenCalledWith(obj);
    expect(obj.visible).toBe(false);
  });

  it('supports releaseAll for collections', () => {
    const pool = new ObjectPool(() => ({ id: Math.random() }));
    const items = [pool.acquire(), pool.acquire(), pool.acquire()];

    pool.releaseAll(items);
    expect(pool.size).toBe(3);
  });

  it('clears pool and calls optional dispose function', () => {
    const dispose = vi.fn();
    const pool = new ObjectPool(() => ({ destroyed: false }));

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();
    pool.release(obj1);
    pool.release(obj2);

    expect(pool.size).toBe(2);
    pool.clear(dispose);

    expect(pool.size).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
