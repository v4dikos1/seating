import {
  implementedWidgetEvents, newRequestId, parseHostMessage, seatingProtocolVersion,
  type WidgetContext, type WidgetEvent, type WidgetSeat,
} from './protocol';

export interface WidgetBridge {
  readonly instanceId: string;
  readonly parentOrigin: string;
  readonly embedded: boolean;
  ready: () => void;
  selectionChanged: (selection: WidgetSeat[]) => void;
  resize: (height: number) => void;
  error: (message: string, code?: string) => void;
  /** Бронь только что создана сервером: сумма и срок — авторитетные, не пересчитанные клиентом. */
  reservationCreated: (reservationId: string, expiresAt: string, totalAmountMinor: number, currency: string) => void;
  /** Своя бронь истекла, отменена или закрыта без оплаты — хост может обновить свой интерфейс. */
  expired: (reservationId: string) => void;
  /** Заказ оплачен, билеты выпущены. */
  purchaseCompleted: (orderId: string, ticketIds: string[]) => void;
  destroy: () => void;
}

export interface WidgetBridgeOptions {
  onContext: (context: WidgetContext) => void;
  onClearSelection?: () => void;
}

/**
 * Сторона виджета. Родительский origin и идентификатор экземпляра приходят строкой адреса —
 * это не секреты; токен и конфигурация приходят только сообщением.
 */
export function createWidgetBridge(options: WidgetBridgeOptions): WidgetBridge {
  const params = new URLSearchParams(window.location.search);
  const instanceId = params.get('instanceId') ?? crypto.randomUUID();
  const parentOrigin = params.get('parentOrigin') ?? '';
  const embedded = window.parent !== window && parentOrigin.length > 0;
  let destroyed = false;

  function post(message: WidgetEvent) {
    if (destroyed || !embedded) return;
    window.parent.postMessage(
      { ...message, protocolVersion: seatingProtocolVersion, instanceId, requestId: newRequestId() },
      parentOrigin);
  }

  function listener(event: MessageEvent) {
    if (destroyed) return;
    if (!embedded || event.origin !== parentOrigin || event.source !== window.parent) return;
    const message = parseHostMessage(event.data, instanceId);
    if (!message) return;
    if (message.type === 'context') options.onContext(message.context);
    if (message.type === 'clearSelection') options.onClearSelection?.();
  }

  window.addEventListener('message', listener);

  return {
    instanceId,
    parentOrigin,
    embedded,
    ready: () => post({ type: 'ready', capabilities: implementedWidgetEvents }),
    selectionChanged: (selection) => post({ type: 'selectionChanged', selection }),
    resize: (height) => post({ type: 'resize', height }),
    error: (message, code) => post({ type: 'error', message, code }),
    reservationCreated: (reservationId, expiresAt, totalAmountMinor, currency) =>
      post({ type: 'reservationCreated', reservationId, expiresAt, totalAmountMinor, currency }),
    expired: (reservationId) => post({ type: 'expired', reservationId }),
    purchaseCompleted: (orderId, ticketIds) => post({ type: 'purchaseCompleted', orderId, ticketIds }),
    destroy() {
      destroyed = true;
      window.removeEventListener('message', listener);
    },
  };
}
