/**
 * Протокол встраивания схемы зала (артефакт 20 §6.1). Одна фиксированная версия на обе
 * стороны: хост и виджет проверяют её в каждом сообщении и молча игнорируют чужое.
 *
 * v2 (Backend `docs/guides/sales.md`): продажи адресуются показом (`occurrenceId`),
 * а не голой конфигурацией. Встраивание остаётся тестовым режимом — короткоживущей сессии,
 * allowlist происхождения и CSP ещё нет (артефакт 20 §6.1).
 */
export const seatingProtocolVersion = 2;

export type WidgetLocale = 'hy' | 'ru' | 'en';

interface WidgetContextBase {
  apiRoot: string;
  /** Токен доступа. Короткоживущей ограниченной сессии показа на сервере ещё нет. */
  token?: string | null;
  locale?: WidgetLocale;
  maxSelection?: number;
}

/**
 * Реальная продажа мест показа (спецификация §2: `GET /api/public/occurrences/{id}/seating`
 * и далее). Тестовый режим обязателен: сервер выдаёт токен покупателя сообщением, отдельной
 * ограниченной сессии встраивания ещё нет.
 */
export interface OccurrenceWidgetContext extends WidgetContextBase {
  occurrenceId: string;
  configurationId?: undefined;
  revision?: undefined;
  testMode: true;
  /** Период опроса `/availability` в миллисекундах. По умолчанию 5000 (спецификация §F2). */
  availabilityIntervalMs?: number;
}

/**
 * Предпросмотр конфигурации организатором до привязки к показу (нет ни продаж, ни брони):
 * режим, которым сегодня пользуется витрина стенда (`apps/seating-lab/src/app/showcase.tsx`).
 */
export interface ConfigurationPreviewWidgetContext extends WidgetContextBase {
  configurationId: string;
  revision?: number | null;
  occurrenceId?: undefined;
  testMode?: undefined;
  availabilityIntervalMs?: undefined;
}

/** Контекст показа. Секрет не передаётся строкой адреса: только сообщением от хоста. */
export type WidgetContext = OccurrenceWidgetContext | ConfigurationPreviewWidgetContext;

export interface WidgetSeat {
  slot: number;
  positionId: string | null;
  zoneId: string;
  zoneName: string;
  row: string;
  label: string;
}

interface Envelope {
  protocolVersion: number;
  instanceId: string;
  requestId: string;
}

export type HostMessage =
  | (Envelope & { type: 'context'; context: WidgetContext })
  | (Envelope & { type: 'clearSelection' });

export type WidgetMessage =
  | (Envelope & { type: 'ready'; capabilities: readonly string[] })
  | (Envelope & { type: 'selectionChanged'; selection: WidgetSeat[] })
  | (Envelope & { type: 'resize'; height: number })
  | (Envelope & { type: 'error'; message: string; code?: string })
  /** Бронь создана: сумма передаётся плоско для совместимости протокола встраивания. */
  | (Envelope & {
      type: 'reservationCreated';
      reservationId: string;
      expiresAt: string;
      totalAmountMinor: number;
      currency: string;
    })
  /** Своя бронь истекла (по серверному времени) или была отменена/завершена без оплаты. */
  | (Envelope & { type: 'expired'; reservationId: string })
  /** Заказ оплачен: билеты выпущены. */
  | (Envelope & { type: 'purchaseCompleted'; orderId: string; ticketIds: string[] });

/** Omit по объединению обязан распределяться, иначе ветви схлопываются в общие поля. */
type PerMember<T, K extends keyof Envelope> = T extends unknown ? Omit<T, K> : never;

/** Сообщение без конверта: конверт добавляют host и guest, а не вызывающий код. */
export type WidgetEvent = PerMember<WidgetMessage, keyof Envelope>;
export type HostCommand = PerMember<HostMessage, keyof Envelope>;

export const hostMessageTypes = ['context', 'clearSelection'] as const;
export const widgetMessageTypes = [
  'ready', 'selectionChanged', 'resize', 'error',
  'reservationCreated', 'expired', 'purchaseCompleted',
] as const;

/** События, которые виджет способен отправить сегодня. Остальные объявлены и не реализованы. */
export const implementedWidgetEvents = [
  'ready', 'selectionChanged', 'resize', 'error',
  'reservationCreated', 'expired', 'purchaseCompleted',
] as const;

export function newRequestId(): string {
  return crypto.randomUUID();
}

function isEnvelope(value: unknown, instanceId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return message['protocolVersion'] === seatingProtocolVersion
    && message['instanceId'] === instanceId
    && typeof message['requestId'] === 'string';
}

/** Чужое окно, другой экземпляр и другая версия протокола отбрасываются без обработки. */
export function parseHostMessage(value: unknown, instanceId: string): HostMessage | null {
  if (!isEnvelope(value, instanceId)) return null;
  const message = value as Record<string, unknown>;
  const type = message['type'];
  if (type === 'clearSelection') return value as HostMessage;
  if (type !== 'context') return null;
  const context = message['context'];
  if (!context || typeof context !== 'object') return null;
  const candidate = context as Record<string, unknown>;
  if (typeof candidate['apiRoot'] !== 'string') return null;
  // Ровно один адресат: показ (продажи) или голая конфигурация (предпросмотр организатора).
  const hasOccurrence = typeof candidate['occurrenceId'] === 'string' && candidate['occurrenceId'] !== '';
  const hasConfiguration = typeof candidate['configurationId'] === 'string' && candidate['configurationId'] !== '';
  if (!hasOccurrence && !hasConfiguration) return null;
  return value as HostMessage;
}

export function parseWidgetMessage(value: unknown, instanceId: string): WidgetMessage | null {
  if (!isEnvelope(value, instanceId)) return null;
  const type = (value as Record<string, unknown>)['type'];
  // Значение приходит из другого окна: без проверки типа оно не становится сообщением.
  return widgetMessageTypes.includes(type as (typeof widgetMessageTypes)[number])
    ? (value as WidgetMessage)
    : null;
}
