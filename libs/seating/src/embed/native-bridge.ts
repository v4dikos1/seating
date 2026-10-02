import {
  parseHostMessage, parseWidgetMessage,
  type HostMessage, type WidgetMessage,
} from './protocol';

/** Имя JS-канала, которое видит Flutter `JavaScriptChannel`: `window[channel].postMessage(string)`. */
export const defaultNativeChannel = 'SeatingBridge';

export interface NativeBridgeOptions {
  /** Экземпляр протокола (`mountSeatingWidget(...).instanceId`), которому адресованы сообщения. */
  instanceId: string;
  /** Имя канала Flutter. React Native использует фиксированный `window.ReactNativeWebView`. */
  channel?: string;
  /** Команда нативного хоста (`context`/`clearSelection`) прошла проверку протокола. */
  onHostMessage?: (message: HostMessage) => void;
  /** Событие встроенного виджета прошло проверку протокола. */
  onWidgetMessage?: (message: WidgetMessage) => void;
}

export interface NativeBridge {
  readonly channel: string;
  /** Публикует сообщение в React Native WebView и во Flutter `JavaScriptChannel` — какие есть. */
  publish: (message: HostMessage | WidgetMessage) => void;
  /** Разбирает команду, присланную нативной стороной через `window.seatingBridge.receive(json)`. */
  receive: (raw: string) => void;
  destroy: () => void;
}

interface NativePostMessageChannel {
  postMessage: (message: string) => void;
}

declare global {
  interface Window {
    ReactNativeWebView?: NativePostMessageChannel;
    /** Точка входа для нативной команды: `window.seatingBridge.receive(JSON.stringify(command))`. */
    seatingBridge?: { receive: (raw: string) => void };
  }
}

/**
 * Мост для WebView (артефакт 20 §6.1: «тот же iframe-клиент в WebView, адаптер сообщений»;
 * встраивание остаётся тестовым режимом — спецификация продаж §0). Публикует сообщения
 * виджета/хоста нативному контейнеру и принимает от него команды тем же строго проверяемым
 * протоколом (`protocol.ts`), что и обычный `postMessage` между окнами на вебе: нативная
 * сторона не получает больше прав, чем родительское окно в браузере.
 */
export function createNativeBridge(options: NativeBridgeOptions): NativeBridge {
  const channel = options.channel ?? defaultNativeChannel;
  let destroyed = false;

  function flutterChannel(): NativePostMessageChannel | null {
    const value = (window as unknown as Record<string, unknown>)[channel];
    return value && typeof (value as NativePostMessageChannel).postMessage === 'function'
      ? (value as NativePostMessageChannel)
      : null;
  }

  function publish(message: HostMessage | WidgetMessage): void {
    if (destroyed) return;
    const raw = JSON.stringify(message);
    window.ReactNativeWebView?.postMessage(raw);
    flutterChannel()?.postMessage(raw);
  }

  function receive(raw: string): void {
    if (destroyed) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      // Нативная сторона прислала не JSON: молча отбрасывается, как и чужое postMessage.
      return;
    }
    const hostMessage = parseHostMessage(value, options.instanceId);
    if (hostMessage) {
      options.onHostMessage?.(hostMessage);
      return;
    }
    const widgetMessage = parseWidgetMessage(value, options.instanceId);
    if (widgetMessage) options.onWidgetMessage?.(widgetMessage);
  }

  // Мост на странице ровно один: предыдущий получатель (если он ещё жив) восстанавливается
  // при destroy, а не затирается навсегда.
  const previousReceiver = window.seatingBridge;
  window.seatingBridge = { receive };

  return {
    channel,
    publish,
    receive,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (window.seatingBridge?.receive === receive) window.seatingBridge = previousReceiver;
    },
  };
}
