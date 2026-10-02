import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSceneGeometry } from './scene';

const created: { posted: unknown[] }[] = [];

class FakeWorker {
  posted: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  constructor() {
    created.push(this);
  }
  postMessage(value: unknown) {
    this.posted.push(value);
  }
  terminate() {
    // Вызывается размонтированием; для проверки достаточно самого факта создания.
  }
}

afterEach(() => {
  created.length = 0;
  vi.unstubAllGlobals();
});

describe('Scene geometry request', () => {
  it('does not invent a hall when there is nothing to draw', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { result } = renderHook(() => useSceneGeometry({}, 'json'));
    // Клиентская часть без ответа API обязана остаться пустой, а не показать синтетику.
    expect(created).toHaveLength(0);
    expect(result.current.rendered).toBeUndefined();
  });

  it('asks the worker for the synthetic bench only when it is requested', () => {
    vi.stubGlobal('Worker', FakeWorker);
    renderHook(() => useSceneGeometry({ synthetic: { count: 8_000, free: false } }, 'json'));
    expect(created).toHaveLength(1);
    expect(created[0].posted[0]).toMatchObject({ synthetic: { count: 8_000 } });
  });
});
