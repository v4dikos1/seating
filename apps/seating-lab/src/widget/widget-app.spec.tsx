import { act } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seatingProtocolVersion } from '@tickets/seating';

const scene = vi.hoisted(() => ({ load: vi.fn(), requests: [] as unknown[] }));

// Сцена и Worker к проверке не относятся: в jsdom нет ни WebGL, ни Worker, поэтому
// подменяется весь модуль сцены, а не только загрузка состава.
vi.mock('../shared/scene', () => ({
  loadRevisionScene: (...args: unknown[]) => scene.load(...args),
  useSceneGeometry: (request: unknown) => {
    scene.requests.push(request);
    return { rendered: null, error: '' };
  },
  useSceneController: () => ({ controller: null, error: '' }),
  buildAddresses: () => new Map(),
}));

const { WidgetApp } = await import('./widget-app');

const instanceId = '33333333-3333-4333-8333-333333333333';
const parentOrigin = 'https://host.test';

class ObserverStub {
  observe() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}

function embed() {
  const parent = { postMessage: () => undefined };
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
  window.history.replaceState(null, '',
    '/widget.html?instanceId=' + instanceId + '&parentOrigin=' + parentOrigin);
  globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;
  return parent;
}

async function sendContext(parent: object, context: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: parentOrigin,
      source: parent as unknown as Window,
      data: {
        type: 'context', protocolVersion: seatingProtocolVersion, instanceId,
        requestId: 'r', context,
      },
    }));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  scene.load.mockReset();
  scene.requests.length = 0;
  window.history.replaceState(null, '', '/');
});

describe('Widget page', () => {
  it('keeps the scene when the host only renews the token', async () => {
    const parent = embed();
    scene.load.mockResolvedValue({ loaded: false });
    render(<WidgetApp />);

    const base = { apiRoot: 'https://api.test', configurationId: 'cfg', revision: null };
    await sendContext(parent, { ...base, token: 'first' });
    expect(scene.load).toHaveBeenCalledTimes(1);

    // Продление сеанса не меняет схему: перечитывание сбросило бы выбор покупателя.
    await sendContext(parent, { ...base, token: 'second' });
    expect(scene.load).toHaveBeenCalledTimes(1);

    // Другая редакция — уже другой состав, его нужно перечитать.
    await sendContext(parent, { ...base, revision: 2, token: 'second' });
    expect(scene.load).toHaveBeenCalledTimes(2);
    expect(scene.load.mock.calls[1][2]).toBe(2);
  });

  it('clears the previous scene as soon as the configuration changes', async () => {
    const parent = embed();
    scene.load.mockResolvedValueOnce({ loaded: true, scene: { configurationId: 'first' } });
    scene.load.mockReturnValueOnce(new Promise(() => undefined));
    render(<WidgetApp />);

    const base = { apiRoot: 'https://api.test', revision: null };
    await sendContext(parent, { ...base, configurationId: 'first' });
    expect(scene.requests.at(-1)).toEqual({ scene: { configurationId: 'first' } });

    await sendContext(parent, { ...base, configurationId: 'second' });
    expect(scene.requests.at(-1)).toEqual({});
  });
});
