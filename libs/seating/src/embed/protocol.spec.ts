import { describe, expect, it } from 'vitest';
import {
  parseHostMessage, parseWidgetMessage, seatingProtocolVersion, type WidgetContext,
} from './protocol';

const instanceId = '11111111-1111-4111-8111-111111111111';
const context: WidgetContext = { apiRoot: 'https://api.test', configurationId: 'cfg' };

function envelope(extra: Record<string, unknown>) {
  return { protocolVersion: seatingProtocolVersion, instanceId, requestId: 'r1', ...extra };
}

const occurrenceContext: WidgetContext = {
  apiRoot: 'https://api.test',
  occurrenceId: 'occ',
  testMode: true,
};

describe('Embedding protocol', () => {
  it('accepts a configuration-preview context addressed to this instance', () => {
    const message = parseHostMessage(envelope({ type: 'context', context }), instanceId);
    expect(message?.type).toBe('context');
  });

  it('accepts an occurrence (real sale, test-mode) context addressed to this instance', () => {
    const message = parseHostMessage(envelope({ type: 'context', context: occurrenceContext }), instanceId);
    expect(message?.type).toBe('context');
  });

  it('drops another instance, another protocol version and an unknown type', () => {
    expect(parseHostMessage(envelope({ type: 'context', context }), 'other')).toBeNull();
    expect(parseHostMessage({ ...envelope({ type: 'context', context }), protocolVersion: 99 }, instanceId)).toBeNull();
    expect(parseHostMessage(envelope({ type: 'evaluate', code: 'alert(1)' }), instanceId)).toBeNull();
    expect(parseHostMessage('context', instanceId)).toBeNull();
    expect(parseHostMessage(null, instanceId)).toBeNull();
  });

  it('requires the context to name an API root and either an occurrence or a configuration', () => {
    expect(parseHostMessage(envelope({ type: 'context', context: {} }), instanceId)).toBeNull();
    expect(parseHostMessage(envelope({ type: 'context' }), instanceId)).toBeNull();
    expect(
      parseHostMessage(envelope({ type: 'context', context: { apiRoot: 'https://api.test' } }), instanceId),
    ).toBeNull();
    expect(
      parseHostMessage(
        envelope({ type: 'context', context: { apiRoot: 'https://api.test', occurrenceId: '' } }),
        instanceId,
      ),
    ).toBeNull();
  });

  it('lets the host read only declared widget events', () => {
    expect(parseWidgetMessage(envelope({ type: 'ready', capabilities: [] }), instanceId)?.type).toBe('ready');
    expect(parseWidgetMessage(envelope({ type: 'resize', height: 500 }), instanceId)?.type).toBe('resize');
    expect(parseWidgetMessage(envelope({ type: 'navigate', url: 'https://evil.test' }), instanceId)).toBeNull();
    expect(parseWidgetMessage(envelope({ type: 'ready' }), 'other')).toBeNull();
  });

  it('recognizes the sales events the widget now sends during a reservation and a purchase', () => {
    expect(
      parseWidgetMessage(
        envelope({
          type: 'reservationCreated',
          reservationId: 'r1',
          expiresAt: '2026-01-01T00:00:00Z',
          totalAmountMinor: 5_000,
          currency: 'AMD',
        }),
        instanceId,
      )?.type,
    ).toBe('reservationCreated');
    expect(
      parseWidgetMessage(envelope({ type: 'expired', reservationId: 'r1' }), instanceId)?.type,
    ).toBe('expired');
    expect(
      parseWidgetMessage(
        envelope({ type: 'purchaseCompleted', orderId: 'o1', ticketIds: ['t1', 't2'] }),
        instanceId,
      )?.type,
    ).toBe('purchaseCompleted');
  });
});
