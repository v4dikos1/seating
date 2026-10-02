import { afterEach, describe, expect, it, vi } from 'vitest'

import { type ApiExchange, SeatingApi, SeatingApiError } from './api'

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

describe('Seating API client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends only the declared query parameters: an unknown one would give 400', async () => {
    const calls = stubFetch(200, {
      items: [],
      totalItems: 0,
      offset: 0,
      limit: 20,
    })
    const api = new SeatingApi({ baseUrl: 'https://api.test/', token: 'jwt' })
    await api.listZones('cfg', {
      revision: 7,
      kind: 'Free',
      sortBy: 'Name',
      searchQuery: '',
    })
    expect(calls[0].url).toBe(
      'https://api.test/api/seating-configurations/cfg/zones?revision=7&kind=Free&sortBy=Name',
    )
    expect(
      (calls[0].init.headers as Record<string, string>)['Authorization'],
    ).toBe('Bearer jwt')
  })

  it('carries the idempotency key of a command and records the exchange', async () => {
    const exchanges: ApiExchange[] = []
    const calls = stubFetch(201, {
      configurationId: 'cfg',
      zoneId: 'zone',
      versions: { zoneVersion: 1, compositionVersion: 1, configurationVersion: 2, configurationRevision: 1 },
    })
    const api = new SeatingApi({
      baseUrl: 'https://api.test',
      onExchange: (value) => exchanges.push(value),
    })
    const geometry = {
      code: 'A',
      name: 'Партер',
      color: '#4275DB',
      x: 0,
      y: 0,
      width: 1_000,
      height: 1_000,
      kind: 'Numbered' as const,
      capacity: null,
      rows: [],
    }
    await api.createZone('cfg', { expectedVersion: 2, geometry }, 'key-1')
    expect(calls[0].init.method).toBe('POST')
    expect(
      (calls[0].init.headers as Record<string, string>)['Idempotency-Key'],
    ).toBe('key-1')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      expectedVersion: 2,
      geometry,
    })
    expect(exchanges[0]).toMatchObject({
      method: 'POST',
      status: 201,
      ok: true,
      idempotencyKey: 'key-1',
    })
  })

  it('sends zone-version concurrency token for geometry replacement', async () => {
    const calls = stubFetch(200, {
      configurationId: 'cfg',
      zoneId: 'zone',
      versions: { zoneVersion: 2, compositionVersion: 2, configurationVersion: 3, configurationRevision: 2 },
    })
    const api = new SeatingApi({ baseUrl: 'https://api.test' })
    const geometry = {
      code: 'A',
      name: 'Партер',
      color: '#4275DB',
      x: 0,
      y: 0,
      width: 1_000,
      height: 1_000,
      kind: 'Numbered' as const,
      capacity: null,
      rows: [],
    }

    await api.saveZone(
      'cfg',
      'zone',
      { expectedZoneVersion: 1, geometry },
      'key-2',
    )

    expect(calls[0].init.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      expectedZoneVersion: 1,
      geometry,
    })
  })

  it('limits PDF calibration precision to four decimals in the floor request', async () => {
    const calls = stubFetch(200, {})
    const api = new SeatingApi({ baseUrl: 'https://api.test' })
    await api.updateFloor('cfg', 'floor', {
      expectedFloorVersion: 1,
      background: { calibration: {
        point1: { x: 12.123456, y: 34.987654 },
        point2: { x: 56.123456, y: 78.987654 },
        distanceMeters: 8.0000001,
      } },
    }, 'key-floor')

    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      expectedFloorVersion: 1,
      background: { calibration: {
        point1: { x: 12.1235, y: 34.9877 },
        point2: { x: 56.1235, y: 78.9877 },
        distanceMeters: 8,
      } },
    })
  })

  it('deletes a saved zone and returns nested version tokens without flat aliases', async () => {
    const exchanges: ApiExchange[] = []
    const calls = stubFetch(200, {
      configurationId: 'cfg',
      zoneId: 'zone',
      versions: { zoneVersion: 3, compositionVersion: 2, configurationVersion: 4, configurationRevision: 3 },
    })
    const api = new SeatingApi({
      baseUrl: 'https://api.test',
      onExchange: (value) => exchanges.push(value),
    })

    const result = await api.deleteZone('cfg', 'zone', 3, 'key-3')

    expect(calls[0].url).toBe(
      'https://api.test/api/seating-configurations/cfg/zones/zone?expectedZoneVersion=3',
    )
    expect(calls[0].init.method).toBe('DELETE')
    expect(
      (calls[0].init.headers as Record<string, string>)['Idempotency-Key'],
    ).toBe('key-3')
    expect(result).toEqual({
      configurationId: 'cfg',
      zoneId: 'zone',
      versions: { zoneVersion: 3, compositionVersion: 2, configurationVersion: 4, configurationRevision: 3 },
    })
    expect(exchanges[0]).toMatchObject({
      method: 'DELETE',
      status: 200,
      ok: true,
      idempotencyKey: 'key-3',
    })
  })

  it('turns a zone deletion version conflict into a typed failure', async () => {
    stubFetch(409, {
      title: 'Conflict',
      detail: 'Версия зоны устарела.',
      errorCode: 'SeatingZoneVersionConflict',
    })
    const api = new SeatingApi({ baseUrl: 'https://api.test' })

    await expect(
      api.deleteZone('cfg', 'zone', 1, 'key-4'),
    ).rejects.toMatchObject({
      status: 409,
      errorCode: 'SeatingZoneVersionConflict',
    })
  })

  it('turns RFC 7807 into a typed failure with the server error code', async () => {
    stubFetch(409, {
      title: 'Conflict',
      detail: 'Версия устарела.',
      errorCode: 'SeatingConfigurationVersionConflict',
      traceId: '00-abc',
    })
    const api = new SeatingApi({ baseUrl: 'https://api.test' })
    await expect(
      api.renameConfiguration('cfg', { expectedVersion: 1 }, 'key'),
    ).rejects.toMatchObject({
      status: 409,
      errorCode: 'SeatingConfigurationVersionConflict',
    })
  })

  it('reads the space directory of the administrator from its own admin route', async () => {
    const calls = stubFetch(200, { items: [], totalItems: 0, offset: 0, limit: 200 })
    const api = new SeatingApi({ baseUrl: 'https://api.test' })

    await api.listAdminVenueSpaces({ limit: 200, includeArchived: true })

    expect(calls[0].url).toBe(
      'https://api.test/api/admin/venue-spaces?limit=200&includeArchived=true',
    )
  })

  it('keeps the organizer route separate from the administrator one', async () => {
    const calls = stubFetch(200, { items: [], totalItems: 0, offset: 0, limit: 20 })
    const api = new SeatingApi({ baseUrl: 'https://api.test' })

    await api.listVenueSpaces({ venueId: 'venue' })

    expect(calls[0].url).toBe('https://api.test/api/venue-spaces?venueId=venue')
  })

  it('previews an uploaded scheme PDF by its actual SHA-256 before it is fixed to a row', async () => {
    const calls = stubFetch(200, {
      sourceFileId: 'pdf-1',
      sha256: 'AB'.repeat(32),
    })
    const api = new SeatingApi({ baseUrl: 'https://api.test' })

    const result = await api.previewOfficialHallSchemeSource('pdf-1')

    expect(calls[0].url).toBe(
      'https://api.test/api/admin/seating-imports/schemes/pdf-1/preview',
    )
    expect(calls[0].init.method).toBe('GET')
    expect(result).toEqual({ sourceFileId: 'pdf-1', sha256: 'AB'.repeat(32) })
  })

  it('reports a refused request as a failure instead of a silent empty page', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('Failed to fetch')))
    const api = new SeatingApi({ baseUrl: 'https://api.test' })
    await expect(api.listVenueSpaces()).rejects.toBeInstanceOf(SeatingApiError)
  })
})
