import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OccurrenceSalesPage } from './occurrence-sales';
import { LabProvider } from './state';

const storageKey = 'seating-lab.connection';
const occurrenceId = '11111111-2222-4333-8444-555555555555';
const layoutKey = 'GET /api/occurrences/' + occurrenceId + '/layout';
const salesKey = 'GET /api/occurrences/' + occurrenceId + '/sales';
const bindKey = 'PUT /api/occurrences/' + occurrenceId + '/layout';
const pricingKey = 'POST /api/occurrences/' + occurrenceId + '/pricing-applications';

function stubStorage() {
  const values = new Map<string, string>([[
    storageKey, JSON.stringify({ baseUrl: 'https://api.test', token: 'jwt' }),
  ]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  });
}

interface Call { key: string; body: unknown; idempotencyKey?: string }
type Reply = { status: number; body: unknown };
const calls: Call[] = [];

function stubApi(routes: Record<string, Reply | (() => Reply)>) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const path = url.replace('https://api.test', '').split('?')[0];
    const key = (init?.method ?? 'GET') + ' ' + path;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      key, body: init?.body ? JSON.parse(String(init.body)) : undefined,
      idempotencyKey: headers['Idempotency-Key'],
    });
    const route = routes[key];
    const reply: Reply = route ? (typeof route === 'function' ? route() : route)
      : { status: 404, body: { title: 'not routed ' + key } };
    return Promise.resolve({
      ok: reply.status < 400, status: reply.status, text: () => Promise.resolve(JSON.stringify(reply.body)),
    } as Response);
  });
}

function page(items: unknown[]) {
  return { items, totalItems: items.length, offset: 0, limit: 200 };
}

const hall = { id: 'cfg-1', name: 'Большой зал' };
const template = {
  id: 'tpl-1', organizerId: 'org', name: 'Летний сезон', currentVersion: 2,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z',
};
const templateVersion = {
  templateId: 'tpl-1', name: 'Летний сезон', version: 2, currentVersion: 2,
  versionCreatedAt: '2026-02-01T00:00:00Z',
  categories: [
    { code: 'A', name: 'Партер', basePrice: { amountMinor: 5000, currency: 'AMD' }, perOrderLimit: null },
    { code: 'B', name: 'Балкон', basePrice: { amountMinor: 3000, currency: 'AMD' }, perOrderLimit: null },
  ],
  rules: [],
};

function zone(id: string, code: string, categoryCode: string | null, saleable = true, kind = 'Rows') {
  return {
    zoneId: id, code, name: 'Зона ' + code, kind, saleable,
    productId: categoryCode ? 'prod-' + code : null, categoryCode,
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  return {
    occurrenceId, configurationId: 'cfg-1', configurationRevision: 4, pricingVersion: 2,
    sourceTemplateId: null, sourceTemplateVersion: null,
    zones: [zone('z1', 'P1', 'A'), zone('z2', 'P2', null), zone('z3', 'FR', null, false, 'Free')],
    products: [], rules: [], ...overrides,
  };
}

const sales = {
  asOf: '2026-03-01T10:00:00Z',
  seating: { occurrenceId, configurationId: 'cfg-1', configurationRevision: 4, pricingVersion: 2, zones: [] },
  units: [{}, {}],
  summary: { zoneId: null, total: 120, available: 101, held: 7, sold: 12 },
  zones: [{ zoneId: 'z1', total: 60, available: 55, held: 2, sold: 3 }],
};

const eventKey = 'GET /api/events';
const eventCardKey = 'GET /api/events/evt-1';
const eventCard = {
  id: 'evt-1', title: 'Гала-концерт',
  occurrences: [
    { id: occurrenceId, startsAt: '2026-07-01T16:30:00Z', timeZone: 'Asia/Yerevan' },
    { id: '99999999-2222-4333-8444-555555555555', startsAt: '2026-07-02T16:30:00Z', timeZone: 'Asia/Yerevan' },
  ],
};

const baseRoutes = () => ({
  'GET /api/seating-configurations': { status: 200, body: page([hall]) },
  'GET /api/price-templates': { status: 200, body: page([template]) },
});

function renderPage(isAdmin = false) {
  return render(<LabProvider><OccurrenceSalesPage isAdmin={isAdmin} /></LabProvider>);
}

async function load(id = occurrenceId) {
  fireEvent.change(screen.getByLabelText('Идентификатор показа (UUID)'), { target: { value: id } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Загрузить' })); });
}

async function click(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  calls.length = 0;
  stubStorage();
});

afterEach(() => vi.unstubAllGlobals());

describe('Occurrence sales page', () => {
  it('принимает выбранные в пути событие и показ', async () => {
    stubApi({
      ...baseRoutes(),
      [eventKey]: { status: 200, body: page([{ id: 'evt-1', title: 'Гала-концерт', status: 'Published' }]) },
      [eventCardKey]: { status: 200, body: eventCard },
    });
    render(<LabProvider><OccurrenceSalesPage isAdmin={false} initialEventId='evt-1' initialOccurrenceId={occurrenceId} /></LabProvider>);
    await screen.findByRole('option', { name: /01\.07\.2026|1 июл/ });
    expect((screen.getByLabelText('Показ') as HTMLSelectElement).value).toBe(occurrenceId);
    expect(await screen.findByText(occurrenceId)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Скопировать' }).length).toBeGreaterThan(0);
  });

  it('rejects an identifier that is not a UUID without calling the API', async () => {
    stubApi(baseRoutes());
    renderPage();

    await load('not-a-uuid');

    expect((await screen.findByRole('alert')).textContent)
      .toContain('Введите корректный идентификатор показа (UUID).');
    expect(calls.some((c) => c.key.includes('/occurrences/'))).toBe(false);
  });

  it('renders the layout and the sales summary from the organizer route', async () => {
    stubApi({
      ...baseRoutes(),
      [layoutKey]: { status: 200, body: setup() },
      [salesKey]: { status: 200, body: sales },
    });
    renderPage();

    await load();

    expect(await screen.findByText('цены v2')).toBeTruthy();
    expect(screen.getByText('«Большой зал»').parentElement?.textContent).toContain('Зал «Большой зал», редакция 4.');
    expect(screen.getByText('«Большой зал»').getAttribute('title')).toBe('cfg-1');
    expect(screen.queryByText(/Конфигурация cfg-1/)).toBeNull();
    expect(screen.getByText(/Цены ещё не применены\./)).toBeTruthy();
    const row = (label: string) =>
      screen.getByText(label, { selector: 'td' }).closest('tr') as HTMLElement;
    expect(within(row('Всего продаваемых мест')).getByText('120')).toBeTruthy();
    expect(within(row('Свободно')).getByText('101')).toBeTruthy();
    expect(within(row('Удержано')).getByText('7')).toBeTruthy();
    expect(within(row('Продано')).getByText('12')).toBeTruthy();
    expect(screen.getByText('P1 — Зона P1', { selector: 'td' }).getAttribute('title')).toBe('z1');
    expect(screen.queryByText('z1')).toBeNull();
    expect(calls.some((c) => c.key.includes('/api/admin/'))).toBe(false);
    expect(screen.queryByText(/Владелец удержания/)).toBeNull();
  });

  it('lets an organizer pick an event and an occurrence instead of typing the UUID', async () => {
    stubApi({
      ...baseRoutes(),
      [eventKey]: { status: 200, body: [{ id: 'evt-1', title: 'Гала-концерт', status: 'Published' }] },
      [eventCardKey]: { status: 200, body: eventCard },
      [layoutKey]: { status: 200, body: setup() },
      [salesKey]: { status: 200, body: sales },
    });
    renderPage();

    await screen.findByRole('option', { name: /Гала-концерт/ });
    expect((screen.getByLabelText('Показ') as HTMLSelectElement).disabled).toBe(true);
    change('Событие', 'evt-1');
    const option = await screen.findByRole('option', { name: /01\.07\.2026|1 июл/ });
    // 16:30 UTC в часовом поясе показа (Asia/Yerevan, UTC+4) — 20:30.
    expect(option.textContent).toContain('20:30');
    expect(option.textContent).toContain('Asia/Yerevan');
    change('Показ', occurrenceId);
    await click('Загрузить');

    expect(await screen.findByText('цены v2')).toBeTruthy();
    expect(calls.some((c) => c.key === layoutKey)).toBe(true);
  });

  it('keeps the manual identifier for an administrator and does not offer events', async () => {
    stubApi({
      ...baseRoutes(),
      [eventKey]: { status: 200, body: [] },
    });
    renderPage(true);

    expect(screen.getByLabelText('Идентификатор показа (UUID)')).toBeTruthy();
    expect(screen.queryByLabelText('Событие')).toBeNull();
    await act(async () => undefined);
    expect(calls.some((c) => c.key === eventKey)).toBe(false);
    expect(calls.some((c) => c.key === 'GET /api/seating-configurations')).toBe(false);
    expect(calls.some((c) => c.key === 'GET /api/price-templates')).toBe(false);
  });

  it('shows the admin dashboard without organizer layout access or organizer-only requests', async () => {
    const adminKey = 'GET /api/admin/occurrences/' + occurrenceId + '/sales';
    stubApi({
      [layoutKey]: { status: 403, body: { title: 'Forbidden' } },
      [adminKey]: { status: 200, body: {
        ...sales,
        seating: { ...sales.seating, zones: [{ zoneId: 'z1', geometry: { code: 'P1', name: 'Зона P1' } }] },
      } },
    });
    renderPage(true);

    await load();

    expect(await screen.findByText(/Владелец удержания/)).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.getByText('P1 — Зона P1', { selector: 'td' })).toBeTruthy();
    expect(calls.map((c) => c.key)).toEqual([adminKey]);
    expect(screen.queryByLabelText('Схема зала')).toBeNull();
    expect(screen.queryByLabelText('Ценовой шаблон')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Привязать' })).toBeNull();
  });

  it('shows the API error when the layout cannot be read', async () => {
    stubApi({
      ...baseRoutes(),
      [layoutKey]: { status: 403, body: { title: 'Forbidden', detail: 'Чужой показ.' } },
    });
    renderPage();

    await load();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Недостаточно прав');
    expect(alert.textContent).toContain('Чужой показ.');
    expect(screen.queryByText('Компоновка')).toBeNull();
  });

  it('offers to bind a configuration when the occurrence has no layout and binds the chosen one', async () => {
    let bound = false;
    stubApi({
      ...baseRoutes(),
      [layoutKey]: () => bound
        ? { status: 200, body: setup() }
        : { status: 404, body: { title: 'Not found', errorCode: 'OccurrenceLayoutNotFound' } },
      [bindKey]: () => {
        bound = true;
        return { status: 200, body: setup() };
      },
      [salesKey]: { status: 200, body: sales },
    });
    renderPage();

    await load();
    expect(await screen.findByText('Компоновка продаж этому показу ещё не привязана.')).toBeTruthy();
    // Без выбранной схемы привязать нельзя.
    expect((screen.getByRole('button', { name: 'Привязать' }) as HTMLButtonElement).disabled).toBe(true);

    await screen.findByRole('option', { name: 'Большой зал' });
    change('Схема зала', 'cfg-1');
    change('Редакция состава (пусто — текущая)', '3');
    await click('Привязать');

    const put = calls.find((c) => c.key === bindKey);
    expect(put?.body).toEqual({ configurationId: 'cfg-1', configurationRevision: 3 });
    expect(put?.idempotencyKey).toBeTruthy();
    // После привязки показ перечитывается и виден блок компоновки.
    expect(await screen.findByText('цены v2')).toBeTruthy();
  });

  it('omits the revision from the bind request when it is left empty and shows a lock error', async () => {
    stubApi({
      ...baseRoutes(),
      [layoutKey]: { status: 404, body: { title: 'Not found', errorCode: 'OccurrenceLayoutNotFound' } },
      [bindKey]: {
        status: 409, body: { title: 'Locked', detail: 'Компоновка заблокирована.', errorCode: 'SalesLayoutLocked' },
      },
    });
    renderPage();

    await load();
    await screen.findByText('Компоновка продаж этому показу ещё не привязана.');
    await screen.findByRole('option', { name: 'Большой зал' });
    change('Схема зала', 'cfg-1');
    await click('Привязать');

    expect(calls.find((c) => c.key === bindKey)?.body).toEqual({ configurationId: 'cfg-1' });
    expect((await screen.findByRole('alert')).textContent).toContain('Компоновка заблокирована.');
  });

  it('applies the chosen template version with the zone assignments', async () => {
    stubApi({
      ...baseRoutes(),
      [layoutKey]: { status: 200, body: setup() },
      [salesKey]: { status: 200, body: sales },
      'GET /api/price-templates/tpl-1': { status: 200, body: templateVersion },
      [pricingKey]: {
        status: 201, body: setup({ pricingVersion: 3, sourceTemplateId: 'tpl-1', sourceTemplateVersion: 2 }),
      },
    });
    renderPage();
    await load();
    await screen.findByText('цены v2');
    await screen.findByRole('option', { name: 'Летний сезон' });

    change('Ценовой шаблон', 'tpl-1');
    expect(await screen.findByText(/Версия v2 · категории: A, B/)).toBeTruthy();
    // Продаваемая зона P1 уже назначена, P2 — нет, зона Free в список не попадает.
    expect(screen.getAllByText('P1 — Зона P1').length).toBe(2);
    // Зона Free показана неактивной строкой с объяснением, выбора категории у неё нет.
    expect(screen.getByText('FR — Зона FR')).toBeTruthy();
    expect(screen.getByText('Не продаётся в первом срезе: свободная зона')).toBeTruthy();
    expect(screen.getAllByRole('option', { name: /A — Партер · 50\sAMD/ }).length).toBe(2);
    const categories = screen.getAllByLabelText('Категория') as HTMLSelectElement[];
    expect(categories.map((s) => s.value)).toEqual(['A', '']);

    fireEvent.change(categories[1], { target: { value: 'B' } });
    await click('Применить версию v2');

    const put = calls.find((c) => c.key === pricingKey);
    expect(put?.body).toEqual({
      templateId: 'tpl-1', templateVersion: 2,
      zones: [{ zoneId: 'z1', categoryCode: 'A' }, { zoneId: 'z2', categoryCode: 'B' }],
    });
    expect(put?.idempotencyKey).toBeTruthy();
    // Успех перечитывает показ.
    expect(calls.filter((c) => c.key === layoutKey).length).toBe(2);
  });

  it('leaves out zones that are set to not sell and shows the server refusal', async () => {
    stubApi({
      ...baseRoutes(),
      [layoutKey]: { status: 200, body: setup() },
      [salesKey]: { status: 200, body: sales },
      'GET /api/price-templates/tpl-1': { status: 200, body: templateVersion },
      [pricingKey]: { status: 409, body: { title: 'Conflict', detail: 'Вид зоны не поддержан.' } },
    });
    renderPage();
    await load();
    await screen.findByText('цены v2');
    await screen.findByRole('option', { name: 'Летний сезон' });
    change('Ценовой шаблон', 'tpl-1');
    await screen.findByText(/Версия v2/);

    fireEvent.change(screen.getAllByLabelText('Категория')[0], { target: { value: '' } });
    await click('Применить версию v2');

    expect(calls.find((c) => c.key === pricingKey)?.body)
      .toEqual({ templateId: 'tpl-1', templateVersion: 2, zones: [] });
    expect((await screen.findByRole('alert')).textContent).toContain('Вид зоны не поддержан.');
  });

  it('says so when no zone of the layout supports sales', async () => {
    stubApi({
      ...baseRoutes(),
      [layoutKey]: { status: 200, body: setup({ zones: [zone('z3', 'FR', null, false, 'Free')] }) },
      [salesKey]: { status: 200, body: sales },
      'GET /api/price-templates/tpl-1': { status: 200, body: templateVersion },
    });
    renderPage();
    await load();
    await screen.findByText('цены v2');
    await screen.findByRole('option', { name: 'Летний сезон' });

    change('Ценовой шаблон', 'tpl-1');

    expect(await screen.findByText(/нет зон, поддерживающих продажу/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Применить версию v2' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });
});
