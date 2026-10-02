import { afterEach, describe, expect, it, vi } from 'vitest'

import { SeatingApiError } from './api'
import { SalesApi, type ApplyOccurrencePricingBody, type CreateReservationBody } from './sales-api'

interface Call {
  url: string
  init: RequestInit
}

function stubFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response)
  })
  return calls
}

describe('Sales API client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists price templates with only declared query parameters', async () => {
    const calls = stubFetch(200, { items: [], totalItems: 0, offset: 0, limit: 20 })
    const api = new SalesApi({ baseUrl: 'https://api.test', token: 'jwt' })

    await api.listPriceTemplates({ limit: 20, includeArchived: true })

    expect(calls[0].url).toBe(
      'https://api.test/api/price-templates?limit=20&includeArchived=true',
    )
    expect(calls[0].init.method).toBe('GET')
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt')
  })

  it('reads one price template version by query parameter', async () => {
    const calls = stubFetch(200, {
      templateId: 'tpl',
      name: 'Стандарт',
      version: 1,
      currentVersion: 2,
      versionCreatedAt: '2026-01-01T00:00:00Z',
      categories: [],
      rules: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    const result = await api.getPriceTemplate('tpl', 1)

    expect(calls[0].url).toBe('https://api.test/api/price-templates/tpl?version=1')
    expect(result.templateId).toBe('tpl')
  })

  it('lists versions and archives a template through their own routes', async () => {
    const calls = stubFetch(200, { items: [], totalItems: 0, offset: 0, limit: 20 })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.listPriceTemplateVersions('tpl', { limit: 20 })
    await api.archivePriceTemplate('tpl', 'archive-key')

    expect(calls[0].url).toBe('https://api.test/api/price-templates/tpl/versions?limit=20')
    expect(calls[1].url).toBe('https://api.test/api/price-templates/tpl/archive')
    expect(calls[1].init.method).toBe('POST')
    expect((calls[1].init.headers as Record<string, string>)['Idempotency-Key']).toBe('archive-key')
  })

  it('creates a price template version 1 and reads the 201 body', async () => {
    const exchanges: unknown[] = []
    const calls = stubFetch(201, {
      templateId: 'tpl',
      name: 'Стандарт',
      version: 1,
      currentVersion: 1,
      versionCreatedAt: '2026-01-01T00:00:00Z',
      categories: [{ code: 'PARTER', name: 'Партер', basePrice: { amountMinor: 500_000, currency: 'AMD' }, perOrderLimit: null }],
      rules: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test', onExchange: (value) => exchanges.push(value) })

    const body = {
      name: 'Стандарт',
      categories: [{ code: 'PARTER', name: 'Партер', basePrice: { amountMinor: 500_000, currency: 'AMD' as const } }],
      rules: [],
    }
    const result = await api.createPriceTemplate(body, 'key-1')

    expect(calls[0].url).toBe('https://api.test/api/price-templates')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-1')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(body)
    expect(result.categories[0].basePrice.amountMinor).toBe(500_000)
    expect(exchanges[0]).toMatchObject({ method: 'POST', status: 201, ok: true, idempotencyKey: 'key-1' })
  })

  it('creates a new price template version with its expected version', async () => {
    const calls = stubFetch(201, {
      templateId: 'tpl',
      name: 'Стандарт',
      version: 2,
      currentVersion: 2,
      versionCreatedAt: '2026-01-01T00:00:00Z',
      categories: [],
      rules: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.createPriceTemplateVersion('tpl', { expectedVersion: 1, categories: [], rules: [] }, 'key-2')

    expect(calls[0].url).toBe('https://api.test/api/price-templates/tpl/versions')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ expectedVersion: 1, categories: [], rules: [] })
  })

  it('turns a stale price template version into a typed 409', async () => {
    stubFetch(409, {
      title: 'Conflict',
      detail: 'Версия изменилась.',
      errorCode: 'PriceTemplateVersionConflict',
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await expect(
      api.createPriceTemplateVersion('tpl', { expectedVersion: 1, categories: [], rules: [] }, 'key'),
    ).rejects.toMatchObject({ status: 409, errorCode: 'PriceTemplateVersionConflict' })
  })

  it('reads the current occurrence sales setup', async () => {
    const calls = stubFetch(200, {
      occurrenceId: 'occ',
      configurationId: 'cfg',
      configurationRevision: 3,
      pricingVersion: 0,
      sourceTemplateId: null,
      sourceTemplateVersion: null,
      zones: [],
      products: [],
      rules: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.getOccurrenceSalesSetup('occ')

    expect(calls[0].url).toBe('https://api.test/api/occurrences/occ/layout')
    expect(calls[0].init.method).toBe('GET')
  })

  it('binds an occurrence to a configuration draft revision', async () => {
    const calls = stubFetch(200, {
      occurrenceId: 'occ',
      configurationId: 'cfg',
      configurationRevision: 3,
      pricingVersion: 0,
      sourceTemplateId: null,
      sourceTemplateVersion: null,
      zones: [],
      products: [],
      rules: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.bindLayout('occ', { configurationId: 'cfg' }, 'key-3')

    expect(calls[0].url).toBe('https://api.test/api/occurrences/occ/layout')
    expect(calls[0].init.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ configurationId: 'cfg' })
  })

  it('applies pricing with the template version and zone-category assignments', async () => {
    const calls = stubFetch(201, {
      occurrenceId: 'occ',
      configurationId: 'cfg',
      configurationRevision: 3,
      pricingVersion: 1,
      sourceTemplateId: 'tpl',
      sourceTemplateVersion: 1,
      zones: [],
      products: [],
      rules: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    const body: ApplyOccurrencePricingBody = {
      templateId: 'tpl',
      templateVersion: 1,
      zones: [{ zoneId: 'zone', categoryCode: 'PARTER' }],
    }
    await api.applyPricing('occ', body, 'key-4')

    expect(calls[0].url).toBe('https://api.test/api/occurrences/occ/pricing-applications')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(body)
  })

  it('reads the organizer sales overview and the admin one from separate routes', async () => {
    const seating = { occurrenceId: 'occ', configurationId: 'cfg', configurationRevision: 1, pricingVersion: 1, zones: [] }
    const calls = stubFetch(200, {
      asOf: '2026-01-01T00:00:00Z',
      seating,
      units: [],
      summary: { zoneId: null, total: 0, available: 0, held: 0, sold: 0 },
      zones: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.getOrganizerSales('occ')
    await api.getAdminSales('occ')

    expect(calls[0].url).toBe('https://api.test/api/occurrences/occ/sales')
    expect(calls[1].url).toBe('https://api.test/api/admin/occurrences/occ/sales')
  })

  it('accepts the nullable fields declared by the OpenAPI contract', async () => {
    const calls = stubFetch(200, {
      occurrenceId: 'occ',
      asOf: '2026-01-01T00:00:00Z',
      units: [{ positionId: 'p1', zoneId: 'z1', status: 'Held', version: 3 }],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    const availability = await api.getAvailability('occ')
    await api.createReservation(
      { occurrenceId: 'occ', positionIds: ['p1'], expectedTotal: null },
      'key-null-total',
    )

    expect(availability.units[0]).not.toHaveProperty('holderSubjectId')
    expect(JSON.parse(calls[1].init.body as string).expectedTotal).toBeNull()
  })

  it('reads the anonymous seating route without a token', async () => {
    const calls = stubFetch(200, {
      occurrenceId: 'occ',
      configurationId: 'cfg',
      configurationRevision: 1,
      pricingVersion: 1,
      zones: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.getPublicSeating('occ')

    expect(calls[0].url).toBe('https://api.test/api/public/occurrences/occ/seating')
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('sends only the declared zone filter to the availability route', async () => {
    const calls = stubFetch(200, { occurrenceId: 'occ', asOf: '2026-01-01T00:00:00Z', units: [] })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.getAvailability('occ', { zoneId: 'zone' })

    expect(calls[0].url).toBe('https://api.test/api/public/occurrences/occ/availability?zoneId=zone')
  })

  it('creates a reservation with the expected total amount and carries its idempotency key', async () => {
    const calls = stubFetch(201, {
      reservationId: 'res',
      occurrenceId: 'occ',
      status: 'Active',
      expiresAt: '2026-01-01T00:10:00Z',
      total: { amountMinor: 5_000, currency: 'AMD' },
      items: [{ positionId: 'p1', productId: 'prod', basePrice: { amountMinor: 5_000, currency: 'AMD' },
        price: { amountMinor: 5_000, currency: 'AMD' } }],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    const body: CreateReservationBody = {
      occurrenceId: 'occ',
      positionIds: ['p1'],
      expectedTotal: { amountMinor: 5_000, currency: 'AMD' },
    }
    const result = await api.createReservation(body, 'key-5')

    expect(calls[0].url).toBe('https://api.test/api/me/reservations')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-5')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(body)
    expect(result.status).toBe('Active')
    expect(result.items[0].productId).toBe('prod')
  })

  it('releases a reservation', async () => {
    const calls = stubFetch(200, {
      reservationId: 'res',
      occurrenceId: 'occ',
      status: 'Released',
      expiresAt: '2026-01-01T00:10:00Z',
      total: { amountMinor: 5_000, currency: 'AMD' },
      items: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.releaseReservation('res', 'key-6')

    expect(calls[0].url).toBe('https://api.test/api/me/reservations/res/release')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-6')
  })

  it('creates an order and can retry payment after a decline', async () => {
    const calls = stubFetch(200, {
      orderId: 'order',
      reservationId: 'res',
      occurrenceId: 'occ',
      status: 'PendingPayment',
      total: { amountMinor: 5_000, currency: 'AMD' },
      reservationExpiresAt: '2026-01-01T00:10:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      paidAt: null,
      attempts: [],
      tickets: [],
      paymentPageUrl: 'http://localhost:4200/mock-payment.html?paymentAttemptId=attempt-1',
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    const created = await api.createOrder({ reservationId: 'res' }, 'key-7')
    expect(calls[0].url).toBe('https://api.test/api/me/orders')
    expect(created.paymentPageUrl).toBe('http://localhost:4200/mock-payment.html?paymentAttemptId=attempt-1')

    await api.retryPayment('order', 'key-8')
    expect(calls[1].url).toBe('https://api.test/api/me/orders/order/payment-attempts')
    expect(calls[1].init.method).toBe('POST')
  })

  it('reads an order and submits a mock payment outcome', async () => {
    const calls = stubFetch(200, {
      orderId: 'order',
      reservationId: 'res',
      occurrenceId: 'occ',
      status: 'Paid',
      total: { amountMinor: 5_000, currency: 'AMD' },
      reservationExpiresAt: '2026-01-01T00:10:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      paidAt: '2026-01-01T00:01:00Z',
      attempts: [{
        paymentAttemptId: 'attempt-1', adapter: 'Mock', status: 'Captured', failureReason: null,
        amount: { amountMinor: 5_000, currency: 'AMD' }, isTest: true, createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z',
      }],
      tickets: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.submitMockOutcome('attempt-1', { outcome: 'Succeeded' }, 'key-9')

    expect(calls[0].url).toBe('https://api.test/api/me/payment-attempts/attempt-1/mock-outcome')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ outcome: 'Succeeded' })
  })

  it('reads a single order', async () => {
    const calls = stubFetch(200, {
      orderId: 'order',
      reservationId: 'res',
      occurrenceId: 'occ',
      status: 'Paid',
      total: { amountMinor: 0, currency: 'AMD' },
      reservationExpiresAt: '2026-01-01T00:10:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      paidAt: '2026-01-01T00:00:00Z',
      attempts: [],
      tickets: [],
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.getOrder('order')

    expect(calls[0].url).toBe('https://api.test/api/me/orders/order')
    expect(calls[0].init.method).toBe('GET')
  })

  it('lists my tickets with paging', async () => {
    const calls = stubFetch(200, { items: [], totalItems: 0, offset: 0, limit: 20 })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await api.getMyTickets({ offset: 20, limit: 20, sortBy: 'StartsAt' })

    expect(calls[0].url).toBe('https://api.test/api/me/tickets?offset=20&limit=20&sortBy=StartsAt')
  })

  it('turns an inventory race into a typed 409 with the server error code', async () => {
    stubFetch(409, {
      title: 'Conflict',
      detail: 'Место уже занято.',
      errorCode: 'InventoryConflict',
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await expect(
      api.createReservation({ occurrenceId: 'occ', positionIds: ['p1'] }, 'key-10'),
    ).rejects.toMatchObject({ status: 409, errorCode: 'InventoryConflict' })
  })

  it('turns a stale expected total amount into a typed 409 with the server error code', async () => {
    stubFetch(409, {
      title: 'Conflict',
      detail: 'Цена изменилась.',
      errorCode: 'SalesPriceChanged',
      currentTotal: { amountMinor: 4500, currency: 'AMD' },
    })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await expect(
      api.createReservation(
        { occurrenceId: 'occ', positionIds: ['p1'], expectedTotal: { amountMinor: 1, currency: 'AMD' } },
        'key-11',
      ),
    ).rejects.toMatchObject({ status: 409, errorCode: 'SalesPriceChanged',
      currentTotal: { amountMinor: 4500, currency: 'AMD' } })
  })

  it('turns a zone without a price into a typed 409', async () => {
    stubFetch(409, { title: 'Conflict', detail: 'Зона не продаётся.', errorCode: 'SalesZoneNotForSale' })
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await expect(
      api.createReservation({ occurrenceId: 'occ', positionIds: ['p1'] }, 'key-12'),
    ).rejects.toMatchObject({ status: 409, errorCode: 'SalesZoneNotForSale' })
  })

  it('reports a refused request as a typed failure instead of a silent empty page', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('Failed to fetch')))
    const api = new SalesApi({ baseUrl: 'https://api.test' })

    await expect(api.getMyTickets()).rejects.toBeInstanceOf(SeatingApiError)
  })
})
