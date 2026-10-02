import {
  newRequestId, parseWidgetMessage, seatingProtocolVersion,
  type HostCommand, type WidgetContext, type WidgetMessage, type WidgetSeat,
} from './protocol';

export interface SeatingWidgetOptions {
  /** Элемент, внутрь которого встраивается iframe. */
  container: HTMLElement;
  /** Адрес страницы виджета; может быть другим origin. */
  src: string;
  context: WidgetContext;
  onEvent?: (message: WidgetMessage) => void;
  onSelectionChange?: (selection: WidgetSeat[]) => void;
  onReady?: () => void;
  onError?: (message: string, code?: string) => void;
  title?: string;
  /** Подстраивать высоту iframe под сообщение resize. По умолчанию да. */
  autoResize?: boolean;
}

export interface SeatingWidgetHandle {
  updateContext: (context: WidgetContext) => void;
  clearSelection: () => void;
  destroy: () => void;
  readonly instanceId: string;
  readonly iframe: HTMLIFrameElement;
}

/**
 * Встраивание схемы зала в чужое приложение: изолированный iframe и постоянная версия
 * протокола. Хост не передаёт цену и статус как авторитетные данные и не получает их.
 */
export function mountSeatingWidget(options: SeatingWidgetOptions): SeatingWidgetHandle {
  const instanceId = crypto.randomUUID();
  const target = new URL(options.src, window.location.href);
  const widgetOrigin = target.origin;
  target.searchParams.set('instanceId', instanceId);
  target.searchParams.set('parentOrigin', window.location.origin);

  const iframe = document.createElement('iframe');
  iframe.src = target.toString();
  iframe.title = options.title ?? 'Схема зала';
  iframe.style.width = '100%';
  iframe.style.height = '640px';
  iframe.style.border = '0';
  iframe.setAttribute('loading', 'lazy');
  // Виджету нужен собственный origin для запросов к API; доступа к документу хоста нет.
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.setAttribute('allow', 'fullscreen');

  let context = options.context;
  let destroyed = false;

  function post(message: HostCommand) {
    if (destroyed || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      { ...message, protocolVersion: seatingProtocolVersion, instanceId, requestId: newRequestId() },
      // Конкретный origin, никогда '*': иначе контекст показа уйдёт любому окну.
      widgetOrigin);
  }

  function listener(event: MessageEvent) {
    if (destroyed) return;
    if (event.origin !== widgetOrigin) return;
    if (event.source !== iframe.contentWindow) return;
    const message = parseWidgetMessage(event.data, instanceId);
    if (!message) return;
    if (message.type === 'ready') post({ type: 'context', context });
    if (message.type === 'selectionChanged') options.onSelectionChange?.(message.selection);
    if (message.type === 'error') options.onError?.(message.message, message.code);
    if (message.type === 'resize' && options.autoResize !== false && message.height > 0)
      iframe.style.height = Math.min(message.height, 4_000) + 'px';
    if (message.type === 'ready') options.onReady?.();
    options.onEvent?.(message);
  }

  window.addEventListener('message', listener);
  options.container.appendChild(iframe);

  return {
    instanceId,
    iframe,
    updateContext(next) {
      context = next;
      post({ type: 'context', context: next });
    },
    clearSelection() {
      post({ type: 'clearSelection' });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('message', listener);
      iframe.remove();
    },
  };
}
