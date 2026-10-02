import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderGeometry, geometryFormatVersion, seatingProtocolVersion, type RenderGeometry } from '@tickets/seating';

const scene = vi.hoisted(() => ({
  onSelect: null as null | ((seat: unknown) => void),
  rendered: undefined as unknown,
}));

// Холст и Worker в jsdom недоступны: подменяется весь модуль сцены. Готовая геометрия
// (`scene.rendered`) собирается тестом из настоящей схемы, а выбор мест имитируется вызовом
// обработчика, который виджет передаёт контроллеру сцены.
vi.mock('../shared/scene', () => ({
  loadRevisionScene: () => Promise.resolve({ loaded: false }),
  useSceneGeometry: () => ({ rendered: scene.rendered, error: '' }),
  useSceneController: (_host: unknown, _rendered: unknown, onSelect: (seat: unknown) => void) => {
    scene.onSelect = onSelect;
    return { controller: null, error: '' };
  },
  buildAddresses: () => new Map(),
}));

const { WidgetApp } = await import('./widget-app');

const zoneTwo = 'zone-2';

function hallGeometry(): RenderGeometry {
  const zone = (id: string, name: string, code: string, ids: string[]) => ({
    zoneId: id, zoneVersion: 1,
    geometry: {
      code, name, color: '#346bcb', x: 0, y: 0, width: 10_000, height: 4_000,
      kind: 'Numbered' as const, capacity: null,
      rows: [{
        id: 'row-' + id, label: '1',
        positions: ids.map((positionId, i) => ({
          id: positionId, label: String(i + 1), x: 1_000 + i * 600, y: 1_000, rotation: 0,
        })),
      }],
    },
  });
  return createRenderGeometry({
    formatVersion: geometryFormatVersion, configurationId: 'cfg', revision: 1,
    zones: [zone('zone-1', 'Зона A', 'A', ['pos-1', 'pos-2']), zone(zoneTwo, 'Свободный танцпол', 'D', ['pos-9'])],
    properties: null,
  });
}

const instanceId = '44444444-4444-4444-8444-444444444444';
const parentOrigin = 'https://host.test';
const occurrenceId = 'occ-1';
const zoneId = 'zone-1';

class ObserverStub {
  observe() { return undefined; }
  disconnect() { return undefined; }
}

interface Posted { type: string; [key: string]: unknown }

function embed() {
  const posted: Posted[] = [];
  const parent = { postMessage: (message: Posted) => { posted.push(message); } };
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
  window.history.replaceState(null, '',
    '/widget.html?instanceId=' + instanceId + '&parentOrigin=' + parentOrigin);
  globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;
  return { parent, posted };
}

async function send(parent: object, data: Record<string, unknown>, origin = parentOrigin) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      origin, source: parent as unknown as Window, data,
    }));
  });
}

const context = {
  apiRoot: 'https://api.test', occurrenceId, token: 'jwt', testMode: true,
  availabilityIntervalMs: 3_600_000,
};

function sendContext(parent: object, version: number = seatingProtocolVersion) {
  return send(parent, {
    type: 'context', protocolVersion: version, instanceId, requestId: 'r', context,
  });
}

function seating() {
  return {
    occurrenceId, configurationId: 'cfg', configurationRevision: 1, pricingVersion: 1,
    zones: [{
      zoneId, zoneVersion: 1, saleable: true,
      geometry: { name: 'Зона A' },
      offer: {
        productId: 'p', categoryCode: 'A', name: 'A', basePrice: { amountMinor: 5000, currency: 'AMD' },
        price: { amountMinor: 4500, currency: 'AMD' }, perOrderLimit: null,
      },
    }, {
      zoneId: zoneTwo, zoneVersion: 1, saleable: false,
      geometry: { name: 'Свободный танцпол' }, offer: null,
    }],
  };
}

function seat(slot: number) {
  return { slot, positionId: 'pos-' + slot, zoneId, zoneName: 'Партер', row: '1', label: String(slot) };
}

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    reservationId: 'res-1', occurrenceId, status: 'Active',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    total: { amountMinor: 9000, currency: 'AMD' },
    items: ['pos-1', 'pos-2'].map((positionId) => ({
      positionId, productId: 'p', address: { zone: { id: zoneId, code: 'A', name: 'Партер' },
        row: '1', table: null, seat: '1' },
      basePrice: { amountMinor: 5000, currency: 'AMD' }, price: { amountMinor: 4500, currency: 'AMD' },
    })),
    ...overrides,
  };
}

function attempt(status: string, failureReason: string | null = null) {
  return {
    paymentAttemptId: 'att-1', adapter: 'Mock', status, failureReason,
    amount: { amountMinor: 9000, currency: 'AMD' },
    isTest: true, createdAt: '2026-01-01T00:00:00Z', completedAt: null,
  };
}

function order(status: string, attemptStatus: string, failureReason: string | null = null) {
  return {
    orderId: 'ord-1', reservationId: 'res-1', occurrenceId, status,
    total: { amountMinor: 9000, currency: 'AMD' },
    reservationExpiresAt: '2030-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    paidAt: status === 'Paid' ? '2026-01-01T00:01:00Z' : null,
    attempts: [attempt(attemptStatus, failureReason)],
    tickets: status === 'Paid'
      ? [{ ticketId: 't-1', orderId: 'ord-1', occurrence: { id: occurrenceId, name: 'Гала',
        startsAt: '2026-01-01T00:00:00Z' }, positionId: 'pos-1', productId: 'p',
        address: { zone: { id: zoneId, code: 'A', name: 'Партер' }, row: '1', table: null, seat: '1' },
        price: { amountMinor: 4500, currency: 'AMD' }, status: 'Issued', issuedAt: '2026-01-01T00:01:00Z' }]
      : [],
    paymentPageUrl: status === 'PendingPayment' ? 'https://pay.test/x' : null,
  };
}

type Reply = { status: number; body: unknown };
type Routes = Record<string, Reply | (() => Reply)>;
const calls: { key: string; body: unknown }[] = [];

function stubApi(routes: Routes) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const path = url.replace('https://api.test', '');
    const key = (init?.method ?? 'GET') + ' ' + path;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[key];
    const reply: Reply = route ? (typeof route === 'function' ? route() : route)
      : { status: 404, body: { title: 'not routed ' + key } };
    return Promise.resolve({
      ok: reply.status < 400, status: reply.status, text: () => Promise.resolve(JSON.stringify(reply.body)),
    } as Response);
  });
}

const baseRoutes = (): Routes => ({
  ['GET /api/public/occurrences/' + occurrenceId + '/seating']: { status: 200, body: seating() },
  ['GET /api/public/occurrences/' + occurrenceId + '/availability?zoneId=' + zoneId]: {
    status: 200, body: { occurrenceId, asOf: new Date().toISOString(), units: [] },
  },
});

async function selectSeats(...slots: number[]) {
  for (const slot of slots) {
    await act(async () => { scene.onSelect?.(seat(slot)); });
  }
}

async function mountWithSeats(routes: Routes) {
  stubApi({ ...baseRoutes(), ...routes });
  const { parent, posted } = embed();
  render(<WidgetApp />);
  await sendContext(parent);
  await screen.findByText('Выбрано: 0 из 10');
  await selectSeats(1, 2);
  return { parent, posted };
}

async function click(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

const reserveKey = 'POST /api/me/reservations';
const orderKey = 'POST /api/me/orders';
const outcomeKey = 'POST /api/me/payment-attempts/att-1/mock-outcome';

beforeEach(() => {
  calls.length = 0;
  scene.rendered = hallGeometry();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  scene.onSelect = null;
  window.history.replaceState(null, '', '/');
});

describe('Sales widget', () => {
  it('sums the server prices of the selected seats and reports the selection to the host', async () => {
    const { posted } = await mountWithSeats({});

    expect(screen.getByText('Сумма: 90 AMD')).toBeTruthy();
    expect(screen.getByText('Выбрано: 2 из 10')).toBeTruthy();
    const selection = posted.filter((m) => m.type === 'selectionChanged').at(-1);
    expect((selection?.selection as unknown[]).length).toBe(2);
  });

  it('offers only zones that are sold online and names the others', async () => {
    await mountWithSeats({});

    const zoneSelect = screen.getByRole('combobox', { name: 'Зона' });
    expect([...zoneSelect.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Зона A']);
    expect(screen.getByText(/Не продаётся онлайн: Свободный танцпол/)).toBeTruthy();
  });

  it('keeps the reserved seats with their addresses, prices, total and timer after booking', async () => {
    await mountWithSeats({ [reserveKey]: { status: 201, body: reservation() } });

    await click('Забронировать');

    expect(screen.getByText('Забронировано: 2')).toBeTruthy();
    expect(screen.getByText('Зона A · ряд 1 · место 1')).toBeTruthy();
    expect(screen.getByText('Зона A · ряд 1 · место 2')).toBeTruthy();
    expect(screen.getAllByText('45 AMD')).toHaveLength(2);
    expect(screen.getByText('Бронь: 90 AMD')).toBeTruthy();
    expect(screen.getByRole('timer')).toBeTruthy();
    expect(screen.queryByText(/pos-1/)).toBeNull();
  });

  it('creates a reservation with the expected total, shows the server total and timer, and tells the host', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { posted } = await mountWithSeats({ [reserveKey]: { status: 201, body: reservation() } });

    await click('Забронировать');

    const sent = calls.find((c) => c.key === reserveKey);
    expect(sent?.body).toEqual({
      occurrenceId, positionIds: ['pos-1', 'pos-2'], expectedTotal: { amountMinor: 9000, currency: 'AMD' },
    });
    expect(screen.getByText('Бронь: 90 AMD')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('Осталось: 10:00');
    const created = posted.find((m) => m.type === 'reservationCreated');
    expect(created).toMatchObject({
      reservationId: 'res-1', totalAmountMinor: 9000, currency: 'AMD',
    });
    expect(screen.getByRole('button', { name: 'Оплатить' })).toBeTruthy();
  });

  it('shows the conflict and stays on the selection step when the seats are taken', async () => {
    const { posted } = await mountWithSeats({
      [reserveKey]: {
        status: 409,
        body: { title: 'Conflict', detail: 'Место уже занято.', errorCode: 'InventoryConflict' },
      },
    });

    await click('Забронировать');

    expect((await screen.findByRole('alert')).textContent).toBe('Место уже занято. Доступность и цены обновляются.');
    expect(screen.queryByRole('button', { name: 'Оплатить' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Забронировать' })).toBeTruthy();
    expect(posted.some((m) => m.type === 'reservationCreated')).toBe(false);
    // После конфликта перечитываются доступность и предложение показа.
    expect(calls.filter((c) => c.key.includes('/availability')).length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.key.includes('/seating')).length).toBeGreaterThanOrEqual(2);
  });

  it('shows a plain error for an unexpected reservation failure', async () => {
    await mountWithSeats({ [reserveKey]: { status: 500, body: { title: 'Boom' } } });

    await click('Забронировать');

    expect((await screen.findByRole('alert')).textContent).toBe('Boom');
    expect(screen.queryByRole('button', { name: 'Оплатить' })).toBeNull();
  });

  it('drops the reservation and sends expired to the host when the timer runs out', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const expiresAt = new Date(Date.now() + 3_000).toISOString();
    const { posted } = await mountWithSeats({
      [reserveKey]: { status: 201, body: reservation({ expiresAt }) },
      'GET /api/me/reservations/res-1': {
        status: 200, body: reservation({ expiresAt, status: 'Expired' }),
      },
    });

    await click('Забронировать');
    expect(screen.getByRole('timer').textContent).toBe('Осталось: 0:03');

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });

    expect(posted.find((m) => m.type === 'expired')).toMatchObject({ reservationId: 'res-1' });
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Забронировать' })).toBeTruthy();
  });

  it('polls the reservation at most once a second while the server still says it is active', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const expiresAt = new Date(Date.now() + 2_000).toISOString();
    let serverStatus = 'Active';
    const { posted } = await mountWithSeats({
      [reserveKey]: { status: 201, body: reservation({ expiresAt }) },
      'GET /api/me/reservations/res-1': () => ({
        status: 200, body: reservation({ expiresAt, status: serverStatus }),
      }),
    });

    await click('Забронировать');
    const polls = () => calls.filter((c) => c.key === 'GET /api/me/reservations/res-1').length;

    // 2 с до срока и ещё 5 с после: клиент считает бронь истёкшей, сервер — активной.
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });

    expect(polls()).toBeGreaterThan(0);
    expect(polls()).toBeLessThanOrEqual(7);
    expect(posted.some((m) => m.type === 'expired')).toBe(false);

    serverStatus = 'Expired';
    // Шаг в одну секунду и отдельный act на каждый: React применяет ответ между тиками.
    for (let second = 0; second < 2; second++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }

    expect(posted.filter((m) => m.type === 'expired')).toHaveLength(1);
    const after = polls();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(polls()).toBe(after);
    expect(posted.filter((m) => m.type === 'expired')).toHaveLength(1);
  });

  it('releases the reservation on request and reports it as expired', async () => {
    const { posted } = await mountWithSeats({
      [reserveKey]: { status: 201, body: reservation() },
      'POST /api/me/reservations/res-1/release': {
        status: 200, body: reservation({ status: 'Released' }),
      },
    });

    await click('Забронировать');
    await click('Отменить бронь');

    expect(calls.some((c) => c.key === 'POST /api/me/reservations/res-1/release')).toBe(true);
    expect(posted.find((m) => m.type === 'expired')).toMatchObject({ reservationId: 'res-1' });
    expect(screen.getByRole('button', { name: 'Забронировать' })).toBeTruthy();
  });

  it('pays through the mock panel and sends purchaseCompleted with the ticket ids', async () => {
    const { posted } = await mountWithSeats({
      [reserveKey]: { status: 201, body: reservation() },
      [orderKey]: { status: 201, body: order('PendingPayment', 'Initiated') },
      [outcomeKey]: { status: 200, body: order('Paid', 'Captured') },
    });

    await click('Забронировать');
    await click('Оплатить');
    expect(calls.find((c) => c.key === orderKey)?.body).toEqual({ reservationId: 'res-1' });
    expect(screen.getByText('ТЕСТОВАЯ ОПЛАТА — деньги не списываются')).toBeTruthy();
    // Пока платёж не подтверждён, хост о покупке не уведомляется.
    expect(posted.some((m) => m.type === 'purchaseCompleted')).toBe(false);

    await click('Успех');

    expect(calls.find((c) => c.key === outcomeKey)?.body).toEqual({ outcome: 'Succeeded' });
    expect(posted.find((m) => m.type === 'purchaseCompleted'))
      .toMatchObject({ orderId: 'ord-1', ticketIds: ['t-1'] });
    expect(screen.getByText('Билеты оформлены')).toBeTruthy();
    expect(screen.getByText('Заказ оплачен.')).toBeTruthy();
    // Билет показывает адрес, возвращённый API.
    expect(screen.getByText('Партер · ряд 1 · место 1')).toBeTruthy();
    expect(screen.getByText('45 AMD')).toBeTruthy();
    expect(screen.queryByText(/ord-1|t-1/)).toBeNull();
  });

  it('stops checking reservation expiry after payment and keeps the issued tickets', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const expiresAt = new Date(Date.now() + 3_000).toISOString();
    const { posted } = await mountWithSeats({
      [reserveKey]: { status: 201, body: reservation({ expiresAt }) },
      [orderKey]: { status: 201, body: order('PendingPayment', 'Initiated') },
      [outcomeKey]: { status: 200, body: order('Paid', 'Captured') },
      'GET /api/me/reservations/res-1': {
        status: 401, body: { title: 'Unauthorized', detail: 'Token expired' },
      },
    });

    await click('Забронировать');
    await click('Оплатить');
    await click('Успех');
    expect(posted.filter((message) => message.type === 'purchaseCompleted')).toHaveLength(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(calls.filter((call) => call.key === 'GET /api/me/reservations/res-1')).toHaveLength(0);
    expect(posted.filter((message) => message.type === 'expired')).toHaveLength(0);
    expect(screen.getByText('Билеты оформлены')).toBeTruthy();
    expect(screen.getByText('Партер · ряд 1 · место 1')).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('completes the purchase immediately when the order comes back already paid', async () => {
    const { posted } = await mountWithSeats({
      [reserveKey]: { status: 201, body: reservation() },
      [orderKey]: { status: 201, body: order('Paid', 'Captured') },
    });

    await click('Забронировать');
    await click('Оплатить');

    expect(posted.find((m) => m.type === 'purchaseCompleted')).toMatchObject({ ticketIds: ['t-1'] });
    expect(screen.getByText('Билеты оформлены')).toBeTruthy();
  });

  it('lets the buyer retry after a declined payment', async () => {
    const { posted } = await mountWithSeats({
      [reserveKey]: { status: 201, body: reservation() },
      [orderKey]: { status: 201, body: order('PendingPayment', 'Initiated') },
      [outcomeKey]: { status: 200, body: order('PendingPayment', 'Failed', 'Declined') },
      'POST /api/me/orders/ord-1/payment-attempts': {
        status: 200, body: order('PendingPayment', 'Initiated'),
      },
    });

    await click('Забронировать');
    await click('Оплатить');
    await click('Отказ');

    expect(calls.find((c) => c.key === outcomeKey)?.body).toEqual({ outcome: 'Declined' });
    expect(screen.getByText('Оплата не прошла: поставщик отклонил платёж.')).toBeTruthy();
    expect(posted.some((m) => m.type === 'purchaseCompleted')).toBe(false);

    await click('Попробовать снова');

    expect(calls.some((c) => c.key === 'POST /api/me/orders/ord-1/payment-attempts')).toBe(true);
    // После новой попытки снова доступна тестовая оплата.
    expect(screen.getByRole('button', { name: 'Успех' })).toBeTruthy();
    expect(screen.queryByText(/Оплата не прошла/)).toBeNull();
  });

  it('names an expired payment attempt differently from a declined one', async () => {
    await mountWithSeats({
      [reserveKey]: { status: 201, body: reservation() },
      [orderKey]: { status: 201, body: order('PendingPayment', 'Initiated') },
      [outcomeKey]: { status: 200, body: order('PendingPayment', 'Failed', 'Expired') },
    });

    await click('Забронировать');
    await click('Оплатить');
    await click('Истечь');

    expect(screen.getByText('Оплата не прошла: истекло время ожидания.')).toBeTruthy();
  });

  it('shows the error of a failed mock outcome without leaving the payment panel', async () => {
    await mountWithSeats({
      [reserveKey]: { status: 201, body: reservation() },
      [orderKey]: { status: 201, body: order('PendingPayment', 'Initiated') },
      [outcomeKey]: { status: 403, body: { title: 'Forbidden', detail: 'Не владелец заказа.' } },
    });

    await click('Забронировать');
    await click('Оплатить');
    await click('Успех');

    expect(await screen.findByText('Не владелец заказа.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Успех' })).toBeTruthy();
  });

  it('ignores host messages with a foreign protocol version', async () => {
    stubApi(baseRoutes());
    const { parent } = embed();
    render(<WidgetApp />);

    await sendContext(parent, seatingProtocolVersion + 1);

    expect(screen.getByText('Ожидание контекста показа…')).toBeTruthy();
    expect(calls.length).toBe(0);

    await sendContext(parent);
    expect(await screen.findByText('Выбрано: 0 из 10')).toBeTruthy();
  });

  it('ignores host messages from a foreign origin or for another instance', async () => {
    stubApi(baseRoutes());
    const { parent } = embed();
    render(<WidgetApp />);

    await send(parent, {
      type: 'context', protocolVersion: seatingProtocolVersion, instanceId, requestId: 'r', context,
    }, 'https://evil.test');
    await send(parent, {
      type: 'context', protocolVersion: seatingProtocolVersion, instanceId: 'other', requestId: 'r', context,
    });

    expect(screen.getByText('Ожидание контекста показа…')).toBeTruthy();
    expect(calls.length).toBe(0);
  });

  it('reports a missing API root to the host and shows no scene', async () => {
    stubApi(baseRoutes());
    const { parent, posted } = embed();
    render(<WidgetApp />);

    await send(parent, {
      type: 'context', protocolVersion: seatingProtocolVersion, instanceId, requestId: 'r',
      context: { ...context, apiRoot: '' },
    });

    expect((await screen.findByText(/Схема недоступна/)).textContent)
      .toContain('Адрес API не передан');
    expect(posted.find((m) => m.type === 'error')).toMatchObject({ code: 'missingApiRoot' });
  });

  it('reports a failed scene load to the host', async () => {
    stubApi({ ['GET /api/public/occurrences/' + occurrenceId + '/seating']: {
      status: 404, body: { title: 'Показ не найден' },
    } });
    const { parent, posted } = embed();
    render(<WidgetApp />);

    await sendContext(parent);

    expect((await screen.findByText(/Схема недоступна/)).textContent).toContain('Показ не найден');
    expect(posted.find((m) => m.type === 'error')).toMatchObject({ code: 'sceneLoadFailed' });
  });
});
