import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWidgetBridge } from './guest';
import { seatingProtocolVersion } from './protocol';

const instanceId = '22222222-2222-4222-8222-222222222222';
const parentOrigin = 'https://host.test';

function embed() {
  const posted: { data: unknown; origin: string }[] = [];
  const parent = { postMessage: (data: unknown, origin: string) => posted.push({ data, origin }) };
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
  window.history.replaceState(null, '', '/widget.html?instanceId=' + instanceId + '&parentOrigin=' + parentOrigin);
  return { posted, parent };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Widget bridge', () => {
  it('announces itself and reports only what it can actually do', () => {
    const { posted } = embed();
    const bridge = createWidgetBridge({ onContext: () => undefined });
    bridge.ready();
    expect(posted[0].origin).toBe(parentOrigin);
    expect(posted[0].data).toMatchObject({ type: 'ready', instanceId, protocolVersion: seatingProtocolVersion });
    expect((posted[0].data as { capabilities: string[] }).capabilities)
      .toEqual(['ready', 'selectionChanged', 'resize', 'error', 'reservationCreated', 'expired', 'purchaseCompleted']);
    bridge.destroy();
  });

  it('sends the sales events the widget now emits during a reservation and a purchase', () => {
    const { posted } = embed();
    const bridge = createWidgetBridge({ onContext: () => undefined });

    bridge.reservationCreated('res-1', '2026-01-01T00:10:00Z', 5_000, 'AMD');
    bridge.expired('res-1');
    bridge.purchaseCompleted('order-1', ['ticket-1', 'ticket-2']);

    expect(posted.map((item) => item.data)).toMatchObject([
      { type: 'reservationCreated', reservationId: 'res-1', expiresAt: '2026-01-01T00:10:00Z', totalAmountMinor: 5_000, currency: 'AMD' },
      { type: 'expired', reservationId: 'res-1' },
      { type: 'purchaseCompleted', orderId: 'order-1', ticketIds: ['ticket-1', 'ticket-2'] },
    ]);
    bridge.destroy();
  });

  it('accepts a context from the parent and ignores another origin', () => {
    const { parent } = embed();
    const received: string[] = [];
    const bridge = createWidgetBridge({
      onContext: (context) => received.push(context.configurationId ?? context.occurrenceId ?? ''),
    });
    const message = {
      type: 'context', protocolVersion: seatingProtocolVersion, instanceId, requestId: 'r',
      context: { apiRoot: 'https://api.test', configurationId: 'cfg' },
    };
    window.dispatchEvent(new MessageEvent('message', { origin: parentOrigin, source: parent as unknown as Window, data: message }));
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test', source: parent as unknown as Window, data: message }));
    expect(received).toEqual(['cfg']);
    bridge.destroy();
  });

  it('stays silent after destroy, so the page must not close it on a re-run effect', () => {
    const { posted } = embed();
    const bridge = createWidgetBridge({ onContext: () => undefined });
    bridge.destroy();
    bridge.error('boom');
    expect(posted).toHaveLength(0);
  });
});
