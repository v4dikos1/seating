import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PricesPage } from './prices';
import { LabProvider } from './state';

const storageKey = 'seating-lab.connection';

/** Подключение лаборатория читает только из localStorage, поэтому хранилище подменяется целиком. */
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

const template = {
  id: 't1', organizerId: 'org', name: 'Летний сезон', currentVersion: 3,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z', archivedAt: null,
};

const version = {
  templateId: 't1', name: 'Летний сезон', version: 3, currentVersion: 3,
  versionCreatedAt: '2026-02-01T00:00:00Z',
  categories: [{ code: 'VIP', name: 'Vip', basePrice: { amountMinor: 9000, currency: 'AMD' }, perOrderLimit: 4 }],
  rules: [{
    ruleNo: 1, kind: 'PercentDiscount', categoryCode: 'VIP', value: 1000,
    period: { from: null, to: null }, priority: 1,
  }],
};

function renderPage() {
  return render(<LabProvider><PricesPage /></LabProvider>);
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

describe('Prices page', () => {
  it('lists the templates with their current version', async () => {
    stubApi({ 'GET /api/price-templates': { status: 200, body: page([template]) } });
    renderPage();

    expect(await screen.findByText('Летний сезон')).toBeTruthy();
    expect(screen.getByText('v3')).toBeTruthy();
    expect(calls[0].key).toBe('GET /api/price-templates');
  });

  it('shows the empty state when there are no templates', async () => {
    stubApi({ 'GET /api/price-templates': { status: 200, body: page([]) } });
    renderPage();

    expect(await screen.findByText('Шаблонов пока нет')).toBeTruthy();
  });

  it('shows the API error when the list cannot be loaded', async () => {
    stubApi({
      'GET /api/price-templates': { status: 403, body: { title: 'Forbidden', detail: 'Нет доступа.' } },
    });
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Недостаточно прав');
    expect(alert.textContent).toContain('Нет доступа.');
  });

  it('creates a template from the draft and reloads the list', async () => {
    const created = { ...version, name: 'Новый', version: 1, currentVersion: 1 };
    stubApi({
      'GET /api/price-templates': { status: 200, body: page([template]) },
      'POST /api/price-templates': { status: 201, body: created },
    });
    renderPage();
    await screen.findByText('Летний сезон');

    await click('Создать шаблон');
    const submit = screen.getByRole('button', { name: 'Создать' }) as HTMLButtonElement;
    // Без названия создавать нельзя.
    expect(submit.disabled).toBe(true);

    change('Название шаблона', '  Новый  ');
    // Код приводится к верхнему регистру: сервер принимает только A-Z0-9_-.
    change('Код (A-Z0-9_-)', 'std');
    change('Название', 'Стандарт');
    change('Базовая цена, AMD', '50');
    await click('Добавить правило');
    change('Значение, %', '15');
    await click('Создать');

    const post = calls.find((c) => c.key === 'POST /api/price-templates');
    expect(post?.body).toEqual({
      name: 'Новый',
      categories: [{ code: 'STD', name: 'Стандарт', basePrice: { amountMinor: 5000, currency: 'AMD' }, perOrderLimit: null }],
      rules: [{ kind: 'PercentDiscount', categoryCode: null, value: 1500,
        period: { from: null, to: null }, priority: 0 }],
    });
    expect(post?.idempotencyKey).toBeTruthy();
    expect(calls.filter((c) => c.key === 'GET /api/price-templates').length).toBe(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog open and shows the error when creation fails', async () => {
    stubApi({
      'GET /api/price-templates': { status: 200, body: page([]) },
      'POST /api/price-templates': { status: 422, body: { title: 'Invalid', detail: 'Код занят.' } },
    });
    renderPage();
    await screen.findByText('Шаблонов пока нет');

    await click('Создать шаблон');
    change('Название шаблона', 'Дубль');
    await click('Создать');

    expect((await screen.findByRole('alert')).textContent).toContain('Код занят.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('loads a version and saves it as a new one against the current version', async () => {
    stubApi({
      'GET /api/price-templates': { status: 200, body: page([template]) },
      'GET /api/price-templates/t1': { status: 200, body: version },
      'POST /api/price-templates/t1/versions': {
        status: 201, body: { ...version, version: 4, currentVersion: 4 },
      },
    });
    renderPage();
    await screen.findByText('Летний сезон');

    await click('Открыть / новая версия');
    expect(await screen.findByText('Текущая версия v3')).toBeTruthy();
    expect(screen.getByText(/заведёт версию v4/)).toBeTruthy();

    change('Базовая цена, AMD', '95');
    await click('Сохранить как новую версию');

    const post = calls.find((c) => c.key === 'POST /api/price-templates/t1/versions');
    expect(post?.idempotencyKey).toBeTruthy();
    const body = post?.body as {
      expectedVersion: number; categories: { code: string; basePrice: { amountMinor: number } }[]; rules: unknown[];
    };
    expect(body.expectedVersion).toBe(3);
    expect(body.categories).toHaveLength(1);
    expect(body.categories[0]).toMatchObject({ code: 'VIP', basePrice: { amountMinor: 9500 } });
    expect(body.rules).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the version conflict when another user changed the template', async () => {
    stubApi({
      'GET /api/price-templates': { status: 200, body: page([template]) },
      'GET /api/price-templates/t1': { status: 200, body: version },
      'POST /api/price-templates/t1/versions': {
        status: 409, body: { title: 'Conflict', errorCode: 'PriceTemplateVersionConflict' },
      },
    });
    renderPage();
    await screen.findByText('Летний сезон');

    await click('Открыть / новая версия');
    await screen.findByText('Текущая версия v3');
    await click('Сохранить как новую версию');

    expect((await screen.findByRole('alert')).textContent).toContain('Конфликт версий');
    expect(within(screen.getByRole('dialog')).getByText('Текущая версия v3')).toBeTruthy();
  });

  it('removes a category and disables saving without categories', async () => {
    stubApi({
      'GET /api/price-templates': { status: 200, body: page([template]) },
      'GET /api/price-templates/t1': { status: 200, body: version },
    });
    renderPage();
    await screen.findByText('Летний сезон');
    await click('Открыть / новая версия');
    await screen.findByText('Текущая версия v3');

    const dialog = within(screen.getByRole('dialog'));
    // Кнопки удаления без подписи: первая в редакторе относится к категории.
    const removeCategory = dialog.getAllByRole('button')
      .find((b) => !b.textContent?.trim() && b.className.includes('danger'));
    await act(async () => { fireEvent.click(removeCategory as HTMLElement); });

    expect(dialog.getByText('Нужна хотя бы одна категория.')).toBeTruthy();
    expect((dialog.getByRole('button', { name: 'Сохранить как новую версию' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });
});
