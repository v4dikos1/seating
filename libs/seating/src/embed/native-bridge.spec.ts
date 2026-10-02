import { afterEach, describe, expect, it } from 'vitest';
import { createNativeBridge, defaultNativeChannel } from './native-bridge';
import { seatingProtocolVersion, type HostMessage, type WidgetMessage } from './protocol';

const instanceId = '44444444-4444-4444-8444-444444444444';

function envelope(extra: Record<string, unknown>) {
  return { protocolVersion: seatingProtocolVersion, instanceId, requestId: 'r1', ...extra };
}

afterEach(() => {
  delete window.ReactNativeWebView;
  delete (window as unknown as Record<string, unknown>)[defaultNativeChannel];
  delete window.seatingBridge;
});

describe('Native WebView bridge', () => {
  it('publishes to React Native WebView when it is present', () => {
    const posted: string[] = [];
    window.ReactNativeWebView = { postMessage: (raw) => posted.push(raw) };
    const bridge = createNativeBridge({ instanceId });

    const message: WidgetMessage = envelope({ type: 'ready', capabilities: [] }) as WidgetMessage;
    bridge.publish(message);

    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0])).toEqual(message);
    bridge.destroy();
  });

  it('publishes to the named Flutter JavaScriptChannel by default and by an explicit name', () => {
    const posted: string[] = [];
    (window as unknown as Record<string, unknown>)[defaultNativeChannel] = {
      postMessage: (raw: string) => posted.push(raw),
    };
    const bridge = createNativeBridge({ instanceId });

    bridge.publish(envelope({ type: 'resize', height: 500 }) as WidgetMessage);
    expect(posted).toHaveLength(1);
    bridge.destroy();

    const customPosted: string[] = [];
    (window as unknown as Record<string, unknown>)['CustomChannel'] = {
      postMessage: (raw: string) => customPosted.push(raw),
    };
    const customBridge = createNativeBridge({ instanceId, channel: 'CustomChannel' });
    customBridge.publish(envelope({ type: 'resize', height: 400 }) as WidgetMessage);
    expect(customPosted).toHaveLength(1);
    expect(posted).toHaveLength(1);
    customBridge.destroy();
    delete (window as unknown as Record<string, unknown>)['CustomChannel'];
  });

  it('registers window.seatingBridge.receive and strictly parses host and widget messages', () => {
    const hostMessages: HostMessage[] = [];
    const widgetMessages: WidgetMessage[] = [];
    createNativeBridge({
      instanceId,
      onHostMessage: (message) => hostMessages.push(message),
      onWidgetMessage: (message) => widgetMessages.push(message),
    });

    expect(typeof window.seatingBridge?.receive).toBe('function');

    window.seatingBridge?.receive(
      JSON.stringify(
        envelope({ type: 'context', context: { apiRoot: 'https://api.test', occurrenceId: 'occ', testMode: true } }),
      ),
    );
    window.seatingBridge?.receive(JSON.stringify(envelope({ type: 'selectionChanged', selection: [] })));

    expect(hostMessages).toHaveLength(1);
    expect(hostMessages[0].type).toBe('context');
    expect(widgetMessages).toHaveLength(1);
    expect(widgetMessages[0].type).toBe('selectionChanged');
  });

  it('drops malformed JSON, another instance and an unknown message type without throwing', () => {
    const hostMessages: HostMessage[] = [];
    const bridge = createNativeBridge({ instanceId, onHostMessage: (message) => hostMessages.push(message) });

    expect(() => bridge.receive('not json')).not.toThrow();
    bridge.receive(
      JSON.stringify({ ...envelope({ type: 'context', context: { apiRoot: 'a', occurrenceId: 'o', testMode: true } }), instanceId: 'other' }),
    );
    bridge.receive(JSON.stringify(envelope({ type: 'evaluate', code: 'alert(1)' })));

    expect(hostMessages).toHaveLength(0);
  });

  it('stops relaying and restores the previous receiver after destroy', () => {
    const first = createNativeBridge({ instanceId });
    const firstReceive = window.seatingBridge?.receive;
    const second = createNativeBridge({ instanceId });
    expect(window.seatingBridge?.receive).not.toBe(firstReceive);

    second.destroy();
    expect(window.seatingBridge?.receive).toBe(firstReceive);

    first.destroy();
    expect(window.seatingBridge).toBeUndefined();
  });
});
