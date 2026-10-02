import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SalesApi, SeatingApi, SeatingApiError, applySalesStatus, createWidgetBridge, formatMoney, geometryFormatVersion,
  newIdempotencyKey, readSalesStatus,
  type ConfigurationPreviewWidgetContext, type OccurrenceSeatingResult, type OccurrenceWidgetContext,
  type OrderResult, type PaymentAttemptResult, type ReservationResult, type ResolvedSeatingProperties,
  type SalesCurrency, type SeatSelection, type SeatingScene, type UnitAvailability, type WidgetBridge,
  type WidgetContext, type WidgetSeat,
} from '@tickets/seating';

import { buildAddresses, loadRevisionScene, useSceneController, useSceneGeometry, type RowSeat, type SceneRequest }
  from '../shared/scene';
import { MockPaymentPanel } from '../shared/mock-payment-panel';
import { SeatLegend } from '../app/seat-legend';
import { buildPositionIndex, formatSeatAddress } from './seat-address';

const storageKey = 'seating-lab.connection';
const defaultAvailabilityIntervalMs = 5_000;

/** Прямое открытие страницы вне iframe: стенд берёт подключение, сохранённое соседней вкладкой. */
function standaloneContext(): WidgetContext | null {
  const params = new URLSearchParams(window.location.search);
  const occurrenceId = params.get('occurrenceId');
  const configurationId = params.get('configurationId');
  if (!occurrenceId && !configurationId) return null;
  let apiRoot = params.get('apiRoot') ?? '';
  let token: string | null = null;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as { baseUrl?: string; token?: string };
      apiRoot = apiRoot || (parsed.baseUrl ?? '');
      token = parsed.token ?? null;
    }
  } catch {
    token = null;
  }
  if (occurrenceId) {
    return { apiRoot, occurrenceId, token, testMode: true };
  }
  const revision = Number(params.get('revision'));
  return {
    apiRoot, configurationId: configurationId as string, token,
    revision: Number.isSafeInteger(revision) && revision > 0 ? revision : null,
  };
}

/** Особенности места называются словами: цветом их отличать недостаточно (артефакт 20 §6). */
function seatBadge(properties: ResolvedSeatingProperties): string {
  const marks: string[] = [];
  if (properties.accessibility === 'Wheelchair') marks.push('кресло-коляска');
  if (properties.accessibility === 'Companion') marks.push('сопровождающий');
  if (properties.accessibility === 'ReducedMobility') marks.push('ограниченная подвижность');
  if (properties.viewObstruction === 'Partial') marks.push('обзор частично закрыт');
  if (properties.viewObstruction === 'Severe') marks.push('обзор сильно ограничен');
  return marks.length ? ' · ' + marks.join(', ') : '';
}

/**
 * Дискриминатор ветки контекста: truthy-проверка `context.occurrenceId` не сужает объединение
 * надёжно (обе ветки объявляют это поле, только с разным типом), поэтому явный предикат.
 */
function isOccurrenceContext(context: WidgetContext): context is OccurrenceWidgetContext {
  return typeof context.occurrenceId === 'string' && context.occurrenceId.length > 0;
}

function toWidgetSeat(seat: SeatSelection): WidgetSeat {
  return {
    slot: seat.slot, positionId: seat.positionId, zoneId: seat.zoneId,
    zoneName: seat.zoneName, row: seat.row, label: seat.label,
  };
}

function formatRemaining(ms: number | null): string {
  if (ms === null) return '';
  const totalSeconds = Math.max(0, Math.ceil(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

/**
 * Корень страницы виджета: заводит мост протокола один раз (сеанс постоянен независимо от
 * контекста) и передаёт готовый контекст в нужную ветку. `occurrenceId` — реальная продажа
 * (эта итерация), голая `configurationId` — предпросмотр конфигурации организатором
 * (`apps/seating-lab/src/app/showcase.tsx`), без продаж и брони.
 */
export function WidgetApp() {
  const [context, setContext] = useState<WidgetContext | null>(null);
  const [waitingHint, setWaitingHint] = useState('Ожидание контекста показа…');

  const bridge = useMemo(() => createWidgetBridge({
    onContext: (next) => setContext(next),
    onClearSelection: () => undefined,
  }), []);

  useEffect(() => {
    bridge.ready();
    if (!bridge.embedded) {
      const direct = standaloneContext();
      if (direct) setContext(direct);
      else setWaitingHint('Виджет открыт напрямую и без параметров показа. Обычно его встраивают в iframe.');
    }
    // Мост живёт столько же, сколько страница виджета, и здесь не закрывается: повторный
    // вызов эффекта в StrictMode закрыл бы его навсегда, и хост перестал бы получать события.
  }, [bridge]);

  useEffect(() => {
    const close = () => bridge.destroy();
    window.addEventListener('pagehide', close);
    return () => window.removeEventListener('pagehide', close);
  }, [bridge]);

  if (!context) {
    return (
      <div className='widget'>
        <p className='widget-status' role='status'>{waitingHint}</p>
      </div>
    );
  }

  return isOccurrenceContext(context)
    ? <OccurrenceSalesWidget context={context} bridge={bridge} />
    : <ConfigurationPreviewWidget context={context} bridge={bridge} />;
}

// --- Реальная продажа (occurrenceId, тестовый режим встраивания) ---------------------------

function OccurrenceSalesWidget({ context, bridge }: { context: OccurrenceWidgetContext; bridge: WidgetBridge }) {
  const host = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const api = useMemo(
    () => new SalesApi({ baseUrl: context.apiRoot, token: context.token }),
    [context.apiRoot, context.token],
  );

  const [seating, setSeating] = useState<OccurrenceSeatingResult | null>(null);
  const [loadError, setLoadError] = useState('');
  const [request, setRequest] = useState<SceneRequest>({});
  const [zoneId, setZoneId] = useState('');
  const [rowLabel, setRowLabel] = useState('');
  const [slot, setSlot] = useState('');
  const [selected, setSelected] = useState<SeatSelection[]>([]);
  const [units, setUnits] = useState<ReadonlyMap<string, UnitAvailability>>(new Map());
  const [clockSkewMs, setClockSkewMs] = useState(0);
  const [reservation, setReservation] = useState<ReservationResult | null>(null);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<'reserve' | 'pay' | 'retry' | 'release' | null>(null);
  const [actionError, setActionError] = useState('');
  const [showLegend, setShowLegend] = useState(false);
  const expiryChecking = useRef(false);
  const paidOrder = useRef(false);

  function updateOrder(next: OrderResult | null) {
    paidOrder.current = next?.status === 'Paid';
    setOrder(next);
  }

  const maxSelection = context.maxSelection ?? 10;
  const availabilityIntervalMs = context.availabilityIntervalMs ?? defaultAvailabilityIntervalMs;

  // --- Загрузка схемы показа (однократно на occurrenceId/подключение) -------------------

  useEffect(() => {
    let cancelled = false;
    if (!context.apiRoot) {
      setLoadError('Адрес API не передан в контексте показа.');
      bridge.error('Адрес API не передан в контексте показа.', 'missingApiRoot');
      return;
    }
    setLoadError('');
    api.getPublicSeating(context.occurrenceId)
      .then((result) => {
        if (cancelled) return;
        setSeating(result);
        const scene: SeatingScene = {
          formatVersion: geometryFormatVersion,
          configurationId: result.configurationId,
          revision: result.configurationRevision,
          zones: result.zones.map((zone) => ({
            zoneId: zone.zoneId, zoneVersion: zone.zoneVersion, geometry: zone.geometry,
          })),
          properties: null,
        };
        setRequest({ scene });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setLoadError(message);
        bridge.error(message, 'sceneLoadFailed');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- api пересобирается вместе с apiRoot/token
  }, [context.apiRoot, context.occurrenceId, bridge]);

  const { rendered, error: workerError } = useSceneGeometry(request, 'json');

  const handleSelect = useCallback((seat: SeatSelection) => {
    setSelected((current) => current.some((item) => item.slot === seat.slot)
      ? current.filter((item) => item.slot !== seat.slot)
      : current.length < maxSelection ? [...current, seat] : current);
  }, [maxSelection]);

  const { controller, error: sceneError } = useSceneController(host, rendered, handleSelect);

  // Зоны, которые онлайн не продаются (свободные зоны, столы), выбором не предлагаются.
  const saleableZones = useMemo(() => (seating?.zones ?? []).filter((item) => item.saleable), [seating]);
  const unsupportedZones = useMemo(() => (seating?.zones ?? []).filter((item) => !item.saleable), [seating]);

  useEffect(() => {
    if (rendered && !zoneId) setZoneId(saleableZones[0]?.zoneId ?? '');
  }, [rendered, zoneId, saleableZones]);

  useEffect(() => {
    controller?.setSelection(new Set(selected.map((seat) => seat.slot)));
    bridge.selectionChanged(selected.map(toWidgetSeat));
  }, [selected, controller, bridge]);

  // --- Опрос доступности: снимок статусов, а не поток дельт ------------------------------

  const saleableZoneIds = useMemo(
    () => new Set((seating?.zones ?? []).filter((zone) => zone.saleable).map((zone) => zone.zoneId)),
    [seating],
  );
  const offerByZone = useMemo(
    () => new Map((seating?.zones ?? []).map((zone) => [zone.zoneId, zone.offer])),
    [seating],
  );

  const pollAvailability = useCallback(async () => {
    if (saleableZones.length === 0) return;
    try {
      // Сервер требует zoneId у показов больше порога; запрос по каждой продаваемой
      // зоне работает и для малого зала, сохраняя выбор мест между зонами.
      const snapshots = await Promise.all(saleableZones.map((zone) =>
        api.getAvailability(context.occurrenceId, { zoneId: zone.zoneId })));
      setUnits(new Map(snapshots.flatMap((snapshot) =>
        snapshot.units.map((unit) => [unit.positionId, unit.status] as const))));
      setClockSkewMs(new Date(snapshots[0].asOf).getTime() - Date.now());
    } catch {
      // Сбой одного опроса не прерывает просмотр схемы: следующий тик попробует снова.
    }
  }, [api, context.occurrenceId, saleableZones]);

  useEffect(() => {
    if (!seating) return;
    void pollAvailability();
    const timer = setInterval(() => { void pollAvailability(); }, availabilityIntervalMs);
    return () => clearInterval(timer);
  }, [seating, pollAvailability, availabilityIntervalMs]);

  useEffect(() => {
    if (!rendered) return;
    applySalesStatus(rendered, { statusByPosition: units, saleableZoneIds });
    controller?.refresh();
  }, [rendered, units, saleableZoneIds, controller]);

  // Хост подстраивает высоту iframe: собственной полосы прокрутки у виджета быть не должно.
  useEffect(() => {
    const element = page.current;
    if (!element) return;
    let reportedHeight = 0;
    const report = () => {
      const height = Math.ceil(element.scrollHeight);
      if (height === reportedHeight) return;
      reportedHeight = height;
      bridge.resize(height);
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [bridge, rendered, reservation, order]);

  // --- Список рядов/мест: доступный путь выбора и единственный способ выбрать место
  //     с клавиатуры или screen reader — те же ограничения продажи, что и на холсте. -------

  const addresses = useMemo(() => {
    const base = buildAddresses(rendered, zoneId);
    if (!rendered) return base;
    const filtered = new Map<string, RowSeat[]>();
    for (const [label, seats] of base) {
      const available = seats.filter((seat) => {
        const status = readSalesStatus(rendered, seat.slot);
        return status === null || status === 'Available';
      });
      if (available.length) filtered.set(label, available);
    }
    return filtered;
    // units формально не читается напрямую, но `readSalesStatus` зависит от применённого
    // оверлея, который меняется вместе с units — пересчёт нужен на каждый опрос.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, zoneId, units]);
  const activeRow = rowLabel || addresses.keys().next().value || '';
  const rowSeats = addresses.get(activeRow) ?? [];
  const zone = rendered?.zones.find((item) => item.zoneId === zoneId);
  const seatingZone = seating?.zones.find((item) => item.zoneId === zoneId);
  const positionIndex = useMemo(
    () => (reservation || order ? buildPositionIndex(rendered) : new Map()),
    [reservation, order, rendered],
  );

  function toggleFromList() {
    const index = slot ? Number(slot) : rowSeats[0]?.slot;
    if (!controller || index === undefined) return;
    handleSelect(controller.describe(index));
  }

  // --- Сумма выбора: только сложение серверных amountMinor, никаких клиентских формул ----

  const totalAmountMinor = useMemo(
    () => selected.reduce((sum, seat) => sum + (offerByZone.get(seat.zoneId)?.price.amountMinor ?? 0), 0),
    [selected, offerByZone],
  );
  const currency: SalesCurrency = seating?.zones.find((z) => z.offer)?.offer?.price.currency ?? 'AMD';

  // --- Бронь, срок, оплата -----------------------------------------------------------------

  async function reserve() {
    const positionIds = selected.map((seat) => seat.positionId).filter((id): id is string => Boolean(id));
    if (!positionIds.length) return;
    setBusyAction('reserve');
    setActionError('');
    try {
      const result = await api.createReservation(
        { occurrenceId: context.occurrenceId, positionIds, expectedTotal: { amountMinor: totalAmountMinor, currency } },
        newIdempotencyKey(),
      );
      setReservation(result);
      updateOrder(null);
      setSelected([]);
      bridge.reservationCreated(result.reservationId, result.expiresAt, result.total.amountMinor, result.total.currency);
    } catch (reason) {
      if (reason instanceof SeatingApiError
        && (reason.errorCode === 'InventoryConflict' || reason.errorCode === 'SalesPriceChanged')) {
        const currentPrice = reason.errorCode === 'SalesPriceChanged' && reason.currentTotal
          ? ` Актуальная сумма: ${formatMoney(reason.currentTotal.amountMinor, reason.currentTotal.currency as SalesCurrency)}.`
          : '';
        setActionError(reason.message + currentPrice + ' Доступность и цены обновляются.');
        void pollAvailability();
        void api.getPublicSeating(context.occurrenceId).then(setSeating).catch(() => {
          // При следующем открытии показ перечитается; исходная ошибка уже видна покупателю.
        });
      } else {
        setActionError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setBusyAction(null);
    }
  }

  const handleExpiry = useCallback(async () => {
    if (!reservation || paidOrder.current || expiryChecking.current) return;
    expiryChecking.current = true;
    try {
      const fresh = await api.getReservation(reservation.reservationId);
      // Оплата могла завершиться, пока GET брони был в пути: поздний ответ уже не
      // должен отменять успешную покупку или посылать хосту ложное истечение.
      if (paidOrder.current) return;
      // Оценка сдвига часов точна до секунды, и клиент может «истечь» раньше сервера. Та же
      // активная бронь не заменяется: новый объект перезапустил бы таймер, тот мгновенно
      // вызвал бы проверку снова, и запросы шли бы без паузы. Повтор — следующим тиком.
      if (fresh.status === 'Active' && fresh.expiresAt === reservation.expiresAt) return;
      setReservation(fresh);
      if (fresh.status !== 'Active') {
        bridge.expired(fresh.reservationId);
        void pollAvailability();
      }
    } catch {
      // Сеть недоступна: следующий тик проверит снова.
    } finally {
      expiryChecking.current = false;
    }
  }, [api, reservation, bridge, pollAvailability]);

  useEffect(() => {
    if (!reservation || reservation.status !== 'Active' || order?.status === 'Paid') {
      setRemainingMs(null);
      return;
    }
    function tick() {
      if (!reservation) return;
      const serverNow = Date.now() + clockSkewMs;
      const remaining = new Date(reservation.expiresAt).getTime() - serverNow;
      setRemainingMs(Math.max(0, remaining));
      if (remaining <= 0) void handleExpiry();
    }
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [reservation, clockSkewMs, handleExpiry, order?.status]);

  async function pay() {
    if (!reservation) return;
    setBusyAction('pay');
    setActionError('');
    try {
      const result = await api.createOrder({ reservationId: reservation.reservationId }, newIdempotencyKey());
      updateOrder(result);
      if (result.status === 'Paid') bridge.purchaseCompleted(result.orderId, result.tickets.map((t) => t.ticketId));
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function retry() {
    if (!order) return;
    setBusyAction('retry');
    setActionError('');
    try {
      updateOrder(await api.retryPayment(order.orderId, newIdempotencyKey()));
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function release() {
    if (!reservation) return;
    setBusyAction('release');
    setActionError('');
    try {
      const result = await api.releaseReservation(reservation.reservationId, newIdempotencyKey());
      setReservation(result);
      updateOrder(null);
      bridge.expired(result.reservationId);
      void pollAvailability();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  }

  function handleMockOutcome(result: OrderResult) {
    updateOrder(result);
    if (result.status === 'Paid') bridge.purchaseCompleted(result.orderId, result.tickets.map((t) => t.ticketId));
  }

  const activeAttempt: PaymentAttemptResult | null = order && order.attempts.length
    ? order.attempts[order.attempts.length - 1]
    : null;
  const reservationActive = reservation?.status === 'Active';
  const showMockPayment = Boolean(
    order && order.status === 'PendingPayment' && order.paymentPageUrl && activeAttempt
      && (activeAttempt.status === 'Initiated' || activeAttempt.status === 'ActionRequired'),
  );
  const showRetry = Boolean(
    order && order.status === 'PendingPayment' && activeAttempt?.status === 'Failed' && reservationActive,
  );
  const showTickets = order?.status === 'Paid';

  return (
    <div className='widget' ref={page}>
      <div className='widget-map'>
        <div className='widget-test-banner' role='status'>
          Тестовый режим — покупка тестовая, деньги не списываются
        </div>
        {/* Указательная поверхность без клавиатурной работы: роль `img` описывала бы
            интерактивную схему картинкой, поэтому для screen reader она скрыта, а
            доступный путь выбора — список рядов и мест справа. */}
        <div className='widget-canvas' ref={host} aria-hidden='true' />
        {loadError ? <p className='widget-error' role='alert'>Схема недоступна: {loadError}</p> : null}
        {workerError || sceneError ? (
          <p className='widget-error' role='alert'>{workerError || sceneError}</p>
        ) : null}
        <div className='widget-hint-row'>
          <p className='widget-hint'>Колесо и жест — масштаб · перетаскивание — навигация</p>
          <button type='button' className='widget-legend-toggle' onClick={() => setShowLegend((v) => !v)}>
            Статусы мест
          </button>
        </div>
        <SeatLegend open={showLegend} onClose={() => setShowLegend(false)} sales />
      </div>
      <aside className='widget-side'>
        <h1>Выбор мест</h1>

        {showTickets && order ? (
          <div className='widget-tickets'>
            <h2>Билеты оформлены</h2>
            <p className='widget-note'>Заказ оплачен.</p>
            <ul className='widget-selection'>
              {order.tickets.map((ticket) => (
                <li key={ticket.ticketId}>
                  <span>{ticket.address.zone.name}
                    {ticket.address.row ? ` · ряд ${ticket.address.row}` : ''}
                    {ticket.address.table ? ` · стол ${ticket.address.table}` : ''}
                    {` · место ${ticket.address.seat}`}</span>
                  <b>{formatMoney(ticket.price.amountMinor, ticket.price.currency)}</b>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {reservationActive ? null : saleableZones.length ? (
              <label>
                <span>Зона</span>
                <select value={zoneId} onChange={(event) => {
                  setZoneId(event.target.value);
                  setRowLabel('');
                  setSlot('');
                  controller?.focusZone(event.target.value);
                }}>
                  {saleableZones.map((item) => (
                    <option key={item.zoneId} value={item.zoneId}>{item.geometry.name}</option>
                  ))}
                </select>
              </label>
            ) : seating ? (
              <p className='widget-note'>На этот показ нет зон, доступных для онлайн-продажи.</p>
            ) : null}
            {reservationActive || !seatingZone ? null : !seatingZone.saleable ? (
              <p className='widget-note'>Эта зона не продаётся онлайн.</p>
            ) : zone?.kind === 'Free' ? (
              <p className='widget-note'>Свободная зона: продажа квоты не реализована.</p>
            ) : (
              <>
                <div className='widget-address'>
                  <label>
                    <span>{zone?.kind === 'Tables' ? 'Стол' : 'Ряд'}</span>
                    <select value={activeRow} onChange={(event) => {
                      setRowLabel(event.target.value);
                      setSlot('');
                    }}>
                      {[...addresses.keys()].map((label) => <option key={label}>{label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>{zone?.kind === 'Tables' ? 'Место за столом' : 'Место'}</span>
                    <select value={slot || String(rowSeats[0]?.slot ?? '')}
                      onChange={(event) => setSlot(event.target.value)}>
                      {rowSeats.map((seat) => (
                        <option key={seat.slot} value={seat.slot}>{seat.label + seatBadge(seat.properties)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type='button' className='widget-primary' disabled={!rowSeats.length || reservationActive}
                  onClick={toggleFromList}>
                  Выбрать или снять выбор
                </button>
              </>
            )}
            {!reservationActive && unsupportedZones.length ? (
              <p className='widget-note widget-unsupported'>
                Не продаётся онлайн: {unsupportedZones.map((item) => item.geometry.name).join(', ')}.
                На схеме такие зоны серые со штриховкой.
              </p>
            ) : null}

            {!reservation || !reservationActive ? (
              <>
                <h2>Выбрано: {selected.length} из {maxSelection}</h2>
                <ul className='widget-selection'>
                  {selected.map((seat) => (
                    <li key={seat.slot}>
                      {seat.zoneName}: ряд {seat.row}, место {seat.label}
                      <button type='button' aria-label={'Убрать место ' + seat.label} onClick={() => handleSelect(seat)}>
                        ×
                      </button>
                    </li>
                  ))}
                  {selected.length === 0 ? <li className='widget-note'>Ничего не выбрано.</li> : null}
                </ul>
                <div className='widget-checkout'>
                  <p className='widget-price'>Сумма: {formatMoney(totalAmountMinor, currency)}</p>
                  <button type='button' className='widget-primary' disabled={!selected.length || busyAction === 'reserve'}
                    onClick={reserve}>
                    {busyAction === 'reserve' ? 'Бронируем…' : 'Забронировать'}
                  </button>
                </div>
              </>
            ) : (
              <div className='widget-checkout'>
                <h2>Забронировано: {reservation.items.length}</h2>
                <ul className='widget-selection widget-reserved'>
                  {reservation.items.map((item) => (
                    <li key={item.positionId}>
                      <span>{formatSeatAddress(positionIndex.get(item.positionId))}</span>
                      <b>{formatMoney(item.price.amountMinor, item.price.currency)}</b>
                    </li>
                  ))}
                </ul>
                <p className='widget-price'>Бронь: {formatMoney(reservation.total.amountMinor, reservation.total.currency)}</p>
                <p className='widget-timer' role='timer'>Осталось: {formatRemaining(remainingMs)}</p>
                {!order ? (
                  <>
                    <button type='button' className='widget-primary' disabled={busyAction === 'pay'} onClick={pay}>
                      {busyAction === 'pay' ? 'Оформляем…' : 'Оплатить'}
                    </button>
                    <button type='button' disabled={busyAction === 'release'} onClick={release}>
                      Отменить бронь
                    </button>
                  </>
                ) : showMockPayment && activeAttempt ? (
                  <MockPaymentPanel
                    api={api}
                    paymentAttemptId={activeAttempt.paymentAttemptId}
                    amountMinor={activeAttempt.amount.amountMinor}
                    currency={activeAttempt.amount.currency}
                    onOutcome={handleMockOutcome}
                  />
                ) : showRetry ? (
                  <>
                    <p className='widget-error' role='alert'>
                      Оплата не прошла: {activeAttempt?.failureReason === 'Declined' ? 'поставщик отклонил платёж' : 'истекло время ожидания'}.
                    </p>
                    <button type='button' className='widget-primary' disabled={busyAction === 'retry'} onClick={retry}>
                      {busyAction === 'retry' ? 'Пробуем снова…' : 'Попробовать снова'}
                    </button>
                    <button type='button' disabled={busyAction === 'release'} onClick={release}>
                      Отменить бронь
                    </button>
                  </>
                ) : (
                  <button type='button' disabled={busyAction === 'release'} onClick={release}>
                    Отменить бронь
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {actionError ? <p className='widget-error' role='alert'>{actionError}</p> : null}
      </aside>
    </div>
  );
}

// --- Предпросмотр конфигурации организатором (без продаж и брони) --------------------------

function ConfigurationPreviewWidget(
  { context, bridge }: { context: ConfigurationPreviewWidgetContext; bridge: WidgetBridge },
) {
  const host = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [request, setRequest] = useState<SceneRequest>({});
  const [selected, setSelected] = useState<SeatSelection[]>([]);
  const [zoneId, setZoneId] = useState('');
  const [rowLabel, setRowLabel] = useState('');
  const [slot, setSlot] = useState('');
  const [status, setStatus] = useState('Загрузка схемы…');
  const [failure, setFailure] = useState('');

  const maxSelection = context.maxSelection ?? 10;

  const toggle = useCallback((seat: SeatSelection) => {
    setSelected((current) => current.some((item) => item.slot === seat.slot)
      ? current.filter((item) => item.slot !== seat.slot)
      : current.length < maxSelection ? [...current, seat] : current);
  }, [maxSelection]);

  const token = useRef<string | null>(null);
  token.current = context.token ?? null;
  const apiRoot = context.apiRoot;
  const configurationId = context.configurationId;
  const revision = context.revision ?? null;

  useEffect(() => {
    setRequest({});
    setSelected([]);
    setZoneId('');
    setRowLabel('');
    setSlot('');
    // Пустой адрес API дал бы относительный запрос к странице виджета и невнятный 404.
    if (!apiRoot) {
      setStatus('');
      setFailure('Адрес API не передан в контексте показа.');
      bridge.error('Адрес API не передан в контексте показа.', 'missingApiRoot');
      return;
    }
    let cancelled = false;
    setStatus('Загрузка схемы…');
    setFailure('');
    const api = new SeatingApi({ baseUrl: apiRoot, token: token.current });
    loadRevisionScene(api, configurationId, revision)
      .then((result) => {
        if (cancelled) return;
        if (!result.loaded) {
          setStatus('У выбранной редакции нет зон.');
          return;
        }
        setStatus('');
        setSelected([]);
        setRequest({ scene: result.scene });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setStatus('');
        setFailure(message);
        bridge.error(message, 'sceneLoadFailed');
      });
    return () => {
      cancelled = true;
    };
  }, [apiRoot, configurationId, revision, bridge]);

  const { rendered, error: workerError } = useSceneGeometry(request, 'json');
  const { controller, error: sceneError } = useSceneController(host, rendered, toggle);

  useEffect(() => {
    if (rendered && !zoneId) setZoneId(rendered.zones[0]?.zoneId ?? '');
  }, [rendered, zoneId]);

  useEffect(() => {
    controller?.setSelection(new Set(selected.map((seat) => seat.slot)));
    bridge.selectionChanged(selected.map(toWidgetSeat));
  }, [selected, controller, bridge]);

  // Хост подстраивает высоту iframe: собственной полосы прокрутки у виджета быть не должно.
  useEffect(() => {
    const element = page.current;
    if (!element) return;
    let reported = 0;
    // Неизменившаяся высота не отправляется: иначе хост получает поток одинаковых событий.
    const report = () => {
      const height = Math.ceil(element.scrollHeight);
      if (height === reported) return;
      reported = height;
      bridge.resize(height);
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [bridge, rendered]);

  const addresses = useMemo(() => buildAddresses(rendered, zoneId), [rendered, zoneId]);
  const activeRow = rowLabel || addresses.keys().next().value || '';
  const rowSeats = addresses.get(activeRow) ?? [];
  const zone = rendered?.zones.find((item) => item.zoneId === zoneId);
  // Служебные позиции описывают разметку зала, но покупателю не предлагаются.
  const offered = useMemo(() => [...addresses.values()].reduce((total, seats) => total + seats.length, 0), [addresses]);
  const withheld = (zone?.count ?? 0) - offered;

  function toggleFromList() {
    const index = slot ? Number(slot) : rowSeats[0]?.slot;
    if (!controller || index === undefined) return;
    toggle(controller.describe(index));
  }

  return (
    <div className='widget' ref={page}>
      <div className='widget-map'>
        {/* Указательная поверхность без клавиатурной работы: роль `img` описывала бы
            интерактивную схему картинкой, поэтому для screen reader она скрыта, а
            доступный путь выбора — список рядов и мест справа. */}
        <div className='widget-canvas' ref={host} aria-hidden='true' />
        {status ? <p className='widget-status' role='status'>{status}</p> : null}
        {failure ? <p className='widget-error' role='alert'>Схема недоступна: {failure}</p> : null}
        {workerError || sceneError ? (
          <p className='widget-error' role='alert'>{workerError || sceneError}</p>
        ) : null}
        <p className='widget-hint'>Колесо и жест — масштаб · перетаскивание — навигация</p>
      </div>
      <aside className='widget-side'>
        <h1>Выбор мест</h1>
        <label>
          <span>Зона</span>
          <select value={zoneId} onChange={(event) => {
            setZoneId(event.target.value);
            setRowLabel('');
            setSlot('');
            controller?.focusZone(event.target.value);
          }}>
            {rendered?.zones.map((item) => (
              <option key={item.zoneId} value={item.zoneId}>
                {item.name}{item.kind === 'Free' ? ' (без мест)' : item.kind === 'Tables' ? ' (столы)' : ''}
              </option>
            ))}
          </select>
        </label>
        {zone?.kind === 'Free' ? (
          <p className='widget-note'>
            Свободная зона: мест нет, вместимость {zone.capacity}. Продажа квоты не реализована.
          </p>
        ) : (
          <>
            <div className='widget-address'>
              <label>
                <span>{zone?.kind === 'Tables' ? 'Стол' : 'Ряд'}</span>
                <select value={activeRow} onChange={(event) => {
                  setRowLabel(event.target.value);
                  setSlot('');
                }}>
                  {[...addresses.keys()].map((label) => <option key={label}>{label}</option>)}
                </select>
              </label>
              <label>
                <span>{zone?.kind === 'Tables' ? 'Место за столом' : 'Место'}</span>
                <select value={slot || String(rowSeats[0]?.slot ?? '')}
                  onChange={(event) => setSlot(event.target.value)}>
                  {rowSeats.map((seat) => (
                    <option key={seat.slot} value={seat.slot}>{seat.label + seatBadge(seat.properties)}</option>
                  ))}
                </select>
              </label>
            </div>
            <button type='button' className='widget-primary' disabled={!rowSeats.length}
              onClick={toggleFromList}>
              Выбрать или снять выбор
            </button>
            {withheld > 0 ? (
              <p className='widget-note'>
                Вне продажи в этой зоне: {withheld}. Служебные позиции в списке не показываются.
              </p>
            ) : null}
          </>
        )}
        <h2>Выбрано: {selected.length} из {maxSelection}</h2>
        <ul className='widget-selection'>
          {selected.map((seat) => {
            const isTable = rendered?.zones.find((z) => z.name === seat.zoneName)?.kind === 'Tables';
            return (
              <li key={seat.slot}>
                {seat.zoneName}: {isTable ? 'стол' : 'ряд'} {seat.row}, место {seat.label}
                <button type='button' aria-label={'Убрать место ' + seat.label}
                  onClick={() => toggle(seat)}>×</button>
              </li>
            );
          })}
          {selected.length === 0 ? <li className='widget-note'>Ничего не выбрано.</li> : null}
        </ul>
        <div className='widget-checkout'>
          <p className='widget-price'>Стоимость — <b>не реализовано</b></p>
          <button type='button' disabled title='Предпросмотр конфигурации: показа и цен ещё нет'>
            Перейти к оплате · не реализовано
          </button>
          <p className='widget-note'>
            Это предпросмотр конфигурации организатором до привязки к показу: выбор места ничего
            не резервирует. Реальная продажа открывается контекстом показа (occurrenceId).
          </p>
        </div>
      </aside>
    </div>
  );
}

export default WidgetApp;
