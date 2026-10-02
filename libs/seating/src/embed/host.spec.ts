import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountSeatingWidget } from './host';
import { seatingProtocolVersion } from './protocol';

const context = { apiRoot: 'https://api.test', configurationId: 'cfg', token: 'secret-token' };

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const events: string[] = [];
  const handle = mountSeatingWidget({
    container, src: '/widget.html', context, onEvent: (message) => events.push(message.type),
  });
  const posted: { data: unknown; origin: string }[] = [];
  Object.defineProperty(handle.iframe, 'contentWindow', {
    configurable: true,
    value: { postMessage: (data: unknown, origin: string) => posted.push({ data, origin }) },
  });
  return { handle, posted, events, container };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Widget host', () => {
  it('puts the instance and the parent origin in the URL and the secret only in a message', () => {
    const { handle, posted } = mount();
    const url = new URL(handle.iframe.src, window.location.href);
    expect(url.searchParams.get('instanceId')).toBe(handle.instanceId);
    expect(url.searchParams.get('parentOrigin')).toBe(window.location.origin);
    expect(handle.iframe.src).not.toContain('secret-token');
    expect(handle.iframe.getAttribute('sandbox')).toContain('allow-scripts');

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: handle.iframe.contentWindow,
      data: { type: 'ready', capabilities: [], protocolVersion: seatingProtocolVersion, instanceId: handle.instanceId, requestId: 'r' },
    }));
    expect(posted).toHaveLength(1);
    expect(posted[0].origin).toBe(window.location.origin);
    expect(posted[0].data).toMatchObject({ type: 'context', context });
    handle.destroy();
  });

  it('ignores another origin, another window and another instance', () => {
    const { handle, posted, events } = mount();
    const ready = { type: 'ready', capabilities: [], protocolVersion: seatingProtocolVersion, instanceId: handle.instanceId, requestId: 'r' };
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.test', source: handle.iframe.contentWindow, data: ready,
    }));
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin, source: window, data: ready,
    }));
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin, source: handle.iframe.contentWindow,
      data: { ...ready, instanceId: 'someone-else' },
    }));
    expect(posted).toHaveLength(0);
    expect(events).toHaveLength(0);
    handle.destroy();
  });

  it('resizes on request and stops listening after destroy', () => {
    const { handle, posted } = mount();
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin, source: handle.iframe.contentWindow,
      data: { type: 'resize', height: 720, protocolVersion: seatingProtocolVersion, instanceId: handle.instanceId, requestId: 'r' },
    }));
    expect(handle.iframe.style.height).toBe('720px');
    handle.destroy();
    handle.updateContext({ ...context, revision: 2 });
    expect(posted).toHaveLength(0);
    expect(document.querySelector('iframe')).toBeNull();
  });
});
