import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { RegistryPage } from './registry'
import { LabProvider } from './state'

const storageKey = 'seating-lab.connection'
const xlsxContentType =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function stubConnection() {
  const values = new Map([
    [storageKey, JSON.stringify({ baseUrl: 'https://api.test', token: 'jwt' })],
  ])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  })
}

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body === null ? '' : JSON.stringify(body)),
  } as Response
}

function failedResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify({ detail: message })),
  } as Response
}

function stagedRegistryResponse(
  fileId: string,
  importId: string,
  prefix: string,
) {
  return response({
    id: importId,
    sourceFileId: fileId,
    uploadedBySubjectId: 'admin-1',
    sha256: 'R'.repeat(64),
    adapter: 'G31OfficialHallRegistry',
    adapterVersion: 'v2',
    state: 'PendingReview',
    stagedAt: '2026-09-27T09:00:00Z',
    report: {
      version: 'v2',
      diagnostics: [],
      rows: [0, 1].map((index) => ({
        venueNameHy: '',
        venueNameRu: `${prefix} площадка ${index + 1}`,
        venueNameEn: `${prefix} venue ${index + 1}`,
        hallNameHy: '',
        hallNameRu: `${prefix} зал ${index + 1}`,
        hallNameEn: `${prefix} hall ${index + 1}`,
        officialSeatCapacity: 100 + index,
        officialSchemeFile: `${prefix}-${index + 1}.pdf`,
        addressHy: '',
        addressRu: '',
        addressEn: '',
        officialWebsite: '',
        phone: '',
        email: '',
        contactSource: '',
        verificationNote: '',
      })),
    },
  })
}

function stagedSchemeResponse(
  sourceFileId: string,
  registryImportId: string,
  registryRowIndex: number,
) {
  return response({
    id: `scheme-import-${sourceFileId}`,
    sourceFileId,
    registryImportId,
    registryRowIndex,
    sha256: 'S'.repeat(64),
    adapter: 'G31OfficialHallScheme',
    adapterVersion: 'v1',
    state: 'PendingReview',
    stagedAt: '2026-09-27T09:15:00Z',
    hall: {
      venueNameHy: '',
      venueNameRu: 'Opera venue',
      venueNameEn: 'Opera venue',
      hallNameHy: '',
      hallNameRu: `Hall ${registryRowIndex + 1}`,
      hallNameEn: `Hall ${registryRowIndex + 1}`,
    },
  })
}

describe('Предпросмотр официального реестра', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uploads XLSX, requests a read-only preview, and renders its content and full hash', async () => {
    stubConnection()
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/api/files/upload-requests')) {
        return Promise.resolve(
          response({
            fileId: 'file-1',
            fileName: 'official.xlsx',
            contentType: xlsxContentType,
            uploadUrl: 'https://storage.test/upload',
            method: 'PUT',
            expiresAt: '2026-09-25T00:00:00Z',
          }),
        )
      }
      if (url === 'https://storage.test/upload')
        return Promise.resolve(response(null))
      if (url.endsWith('/api/admin/seating-imports/registry/file-1/preview')) {
        return Promise.resolve(
          response({
            fileId: 'file-1',
            fileName: 'official.xlsx',
            sha256: 'a'.repeat(64),
            version: 'v2',
            catalogMatchingAvailable: true,
            rows: [
              {
                venueNameHy: 'Օպերա',
                venueNameRu: 'Опера',
                venueNameEn: 'Opera',
                hallNameHy: 'Մեծ դահլիճ',
                hallNameRu: 'Большой зал',
                hallNameEn: 'Main Hall',
                officialSeatCapacity: 620,
                officialSchemeFile: 'opera.pdf',
                addressHy: '',
                addressRu: 'Ереван',
                addressEn: 'Yerevan',
                officialWebsite: '',
                phone: '',
                email: '',
                contactSource: '',
                verificationNote: '',
                match: {
                  venueCandidates: ['venue-123'],
                  venueSpaceCandidates: ['space-456'],
                  requiresManualConfirmation: true,
                  diagnostics: [
                    {
                      code: 'VenueMatchAmbiguous',
                      message: 'Подтвердите площадку вручную.',
                    },
                  ],
                },
              },
            ],
            diagnostics: [
              {
                code: 'ReviewNeeded',
                row: 7,
                message: 'Проверьте название зала.',
              },
            ],
          }),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const { container } = render(
      <LabProvider>
        <RegistryPage />
      </LabProvider>,
    )
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('XLSX input is missing')
    fireEvent.change(input, {
      target: {
        files: [
          new File(['xlsx bytes'], 'official.xlsx', { type: xlsxContentType }),
        ],
      },
    })

    expect(await screen.findByText('Большой зал')).toBeTruthy()
    expect(screen.getByText(/SHA-256: a{64}/)).toBeTruthy()
    expect(screen.getByText('Проверьте название зала.')).toBeTruthy()
    expect(screen.getByText('venue-123')).toBeTruthy()
    expect(screen.getByText('space-456')).toBeTruthy()
    expect(screen.getByText('Подтвердите площадку вручную.')).toBeTruthy()
    expect(screen.getByText('Нужно подтвердить вручную')).toBeTruthy()
    expect(screen.getByText('Опера')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /импортировать|опубликовать/i }),
    ).toBeNull()
    expect(
      (
        screen.getByRole('button', {
          name: 'Сохранить на выверку',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.test/api/files/upload-requests',
      'https://storage.test/upload',
      'https://api.test/api/admin/seating-imports/registry/file-1/preview',
    ])
    const uploadBody = JSON.parse(String(calls[0].init?.body)) as {
      fileName: string
      contentType: string
    }
    expect(uploadBody).toEqual({
      fileName: 'official.xlsx',
      contentType: xlsxContentType,
    })
    expect(calls[1].init?.method).toBe('PUT')
    expect(calls[2].init?.method).toBe('GET')
    await waitFor(() =>
      expect(screen.queryByText('Разбираем реестр…')).toBeNull(),
    )
  })

  it('retries a failed XLSX preview without uploading the file again', async () => {
    stubConnection()
    const calls: { url: string; init?: RequestInit }[] = []
    let previewCount = 0
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/api/files/upload-requests'))
        return Promise.resolve(
          response({
            fileId: 'xlsx-pending',
            fileName: 'pending.xlsx',
            contentType: xlsxContentType,
            uploadUrl: 'https://storage.test/xlsx-pending',
            method: 'PUT',
            expiresAt: '2026-09-27T00:00:00Z',
          }),
        )
      if (url === 'https://storage.test/xlsx-pending')
        return Promise.resolve(response(null))
      if (url.endsWith('/api/admin/seating-imports/registry/xlsx-pending/preview')) {
        previewCount += 1
        if (previewCount === 1)
          return Promise.resolve(failedResponse(503, 'Temporary failure'))
        return Promise.resolve(
          response({
            fileId: 'xlsx-pending',
            fileName: 'pending.xlsx',
            sha256: 'X'.repeat(64),
            version: 'v2',
            catalogMatchingAvailable: false,
            diagnostics: [],
            rows: [
              {
                venueNameHy: '',
                venueNameRu: 'Загруженный зал',
                venueNameEn: 'Uploaded Hall',
                hallNameHy: '',
                hallNameRu: 'Большой зал',
                hallNameEn: 'Main Hall',
                officialSeatCapacity: 400,
                officialSchemeFile: '',
                addressHy: '',
                addressRu: '',
                addressEn: '',
                officialWebsite: '',
                phone: '',
                email: '',
                contactSource: '',
                verificationNote: '',
                match: {
                  venueCandidates: [],
                  venueSpaceCandidates: [],
                  requiresManualConfirmation: true,
                  diagnostics: [],
                },
              },
            ],
          }),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const { container } = render(
      <LabProvider>
        <RegistryPage />
      </LabProvider>,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('XLSX input is missing')
    fireEvent.change(input, {
      target: {
        files: [
          new File(['xlsx bytes'], 'pending.xlsx', { type: xlsxContentType }),
        ],
      },
    })

    expect(await screen.findByText(/XLSX загружен: pending\.xlsx/)).toBeTruthy()
    expect(screen.getByText('xlsx-pending')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Повторить предпросмотр' }),
    )
    expect(await screen.findByText('Большой зал')).toBeTruthy()
    expect(
      calls.filter((call) => call.url.endsWith('/api/files/upload-requests')),
    ).toHaveLength(1)
    expect(
      calls.filter((call) => call.url === 'https://storage.test/xlsx-pending'),
    ).toHaveLength(1)
    const previews = calls.filter((call) =>
      call.url.endsWith('/api/admin/seating-imports/registry/xlsx-pending/preview'),
    )
    expect(previews).toHaveLength(2)
    expect(previews.every((call) => call.init?.method === 'GET')).toBe(true)
  })

  it('stages a clean recognized report with an idempotency key and shows its review record', async () => {
    stubConnection()
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/api/files/upload-requests')) {
        return Promise.resolve(
          response({
            fileId: 'file-2',
            fileName: 'official-v2.xlsx',
            contentType: xlsxContentType,
            uploadUrl: 'https://storage.test/upload-2',
            method: 'PUT',
            expiresAt: '2026-09-25T00:00:00Z',
          }),
        )
      }
      if (url === 'https://storage.test/upload-2')
        return Promise.resolve(response(null))
      if (url.endsWith('/api/admin/seating-imports/registry/file-2/preview')) {
        return Promise.resolve(
          response({
            fileId: 'file-2',
            fileName: 'official-v2.xlsx',
            sha256: 'B'.repeat(64),
            version: 'v2',
            catalogMatchingAvailable: true,
            rows: [
              {
                venueNameHy: 'Օպերա',
                venueNameRu: 'Опера',
                venueNameEn: 'Opera',
                hallNameHy: 'Մեծ դահլիճ',
                hallNameRu: 'Большой зал',
                hallNameEn: 'Main Hall',
                officialSeatCapacity: 620,
                officialSchemeFile: 'opera.pdf',
                addressHy: '',
                addressRu: 'Ереван',
                addressEn: 'Yerevan',
                officialWebsite: '',
                phone: '',
                email: '',
                contactSource: '',
                verificationNote: '',
                match: {
                  venueCandidates: ['venue-123'],
                  venueSpaceCandidates: ['space-456'],
                  requiresManualConfirmation: true,
                  diagnostics: [],
                },
              },
            ],
            diagnostics: [],
          }),
        )
      }
      if (url.endsWith('/api/admin/seating-imports/registry/file-2/stage')) {
        return Promise.resolve(
          response({
            id: 'import-123',
            sourceFileId: 'file-2',
            uploadedBySubjectId: 'subject-1',
            sha256: 'B'.repeat(64),
            adapter: 'G31OfficialHallRegistry',
            adapterVersion: 'v2',
            state: 'PendingReview',
            stagedAt: '2026-09-25T08:15:30+00:00',
            report: {
              version: 'v2',
              diagnostics: [],
              rows: [
                {
                  venueNameHy: 'Օպերա',
                  venueNameRu: 'Опера',
                  venueNameEn: 'Opera',
                  hallNameHy: 'Մեծ դահլիճ',
                  hallNameRu: 'Большой зал',
                  hallNameEn: 'Main Hall',
                  officialSeatCapacity: 620,
                  officialSchemeFile: 'opera.pdf',
                  addressHy: '',
                  addressRu: 'Ереван',
                  addressEn: 'Yerevan',
                  officialWebsite: '',
                  phone: '',
                  email: '',
                  contactSource: '',
                  verificationNote: '',
                },
              ],
            },
          }),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const { container } = render(
      <LabProvider>
        <RegistryPage />
      </LabProvider>,
    )
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('XLSX input is missing')
    fireEvent.change(input, {
      target: {
        files: [
          new File(['xlsx bytes'], 'official-v2.xlsx', {
            type: xlsxContentType,
          }),
        ],
      },
    })
    expect(await screen.findByText('Большой зал')).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: 'Сохранить на выверку' }),
    )

    expect((await screen.findAllByText('import-123')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('PendingReview').length).toBeGreaterThan(0)
    expect(screen.getAllByText('B'.repeat(64)).length).toBeGreaterThan(0)
    expect(screen.getByText('2026-09-25T08:15:30+00:00')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /применить|опубликовать/i }),
    ).toBeNull()
    const stageCall = calls.find((call) =>
      call.url.endsWith('/api/admin/seating-imports/registry/file-2/stage'),
    )
    expect(stageCall?.init?.method).toBe('POST')
    expect(
      (stageCall?.init?.headers as Record<string, string>)['Idempotency-Key'],
    ).toBeTruthy()
  })

  it('explains that a non-XLSX file cannot be previewed', async () => {
    stubConnection()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(
      <LabProvider>
        <RegistryPage />
      </LabProvider>,
    )
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('XLSX input is missing')
    fireEvent.change(input, {
      target: {
        files: [new File(['pdf'], 'hall.pdf', { type: 'application/pdf' })],
      },
    })

    expect(
      await screen.findByText(
        'Выберите файл официального реестра с расширением .xlsx.',
      ),
    ).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads a PDF only after explicit XLSX row selection and preserves review provenance', async () => {
    stubConnection()
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/api/files/upload-requests')) {
        const body = JSON.parse(String(init?.body)) as { fileName: string }
        const pdf = body.fileName.endsWith('.pdf')
        return Promise.resolve(
          response({
            fileId: pdf ? 'pdf-file-7' : 'xlsx-file-7',
            fileName: body.fileName,
            contentType: pdf ? 'application/pdf' : xlsxContentType,
            uploadUrl: pdf
              ? 'https://storage.test/pdf-7'
              : 'https://storage.test/xlsx-7',
            method: 'PUT',
            expiresAt: '2026-09-25T00:00:00Z',
          }),
        )
      }
      if (url.startsWith('https://storage.test/'))
        return Promise.resolve(response(null))
      if (
        url.endsWith('/api/admin/seating-imports/registry/xlsx-file-7/preview')
      ) {
        return Promise.resolve(
          response({
            fileId: 'xlsx-file-7',
            fileName: 'registry.xlsx',
            sha256: 'X'.repeat(64),
            version: 'v2',
            catalogMatchingAvailable: false,
            diagnostics: [],
            rows: [
              {
                venueNameHy: '',
                venueNameRu: 'Опера',
                venueNameEn: 'Opera',
                hallNameHy: '',
                hallNameRu: 'Большой зал',
                hallNameEn: 'Main Hall',
                officialSeatCapacity: 620,
                officialSchemeFile: 'opera.pdf',
                addressHy: '',
                addressRu: '',
                addressEn: '',
                officialWebsite: '',
                phone: '',
                email: '',
                contactSource: '',
                verificationNote: '',
                match: {
                  venueCandidates: [],
                  venueSpaceCandidates: [],
                  requiresManualConfirmation: true,
                  diagnostics: [],
                },
              },
            ],
          }),
        )
      }
      if (
        url.endsWith('/api/admin/seating-imports/registry/xlsx-file-7/stage')
      ) {
        return Promise.resolve(
          response({
            id: 'registry-import-7',
            sourceFileId: 'xlsx-file-7',
            uploadedBySubjectId: 'admin-1',
            sha256: 'X'.repeat(64),
            adapter: 'G31OfficialHallRegistry',
            adapterVersion: 'v2',
            state: 'PendingReview',
            stagedAt: '2026-09-25T09:00:00Z',
            report: {
              version: 'v2',
              diagnostics: [],
              rows: [
                {
                  venueNameHy: '',
                  venueNameRu: 'Опера',
                  venueNameEn: 'Opera',
                  hallNameHy: '',
                  hallNameRu: 'Большой зал',
                  hallNameEn: 'Main Hall',
                  officialSeatCapacity: 620,
                  officialSchemeFile: 'opera.pdf',
                  addressHy: '',
                  addressRu: '',
                  addressEn: '',
                  officialWebsite: '',
                  phone: '',
                  email: '',
                  contactSource: '',
                  verificationNote: '',
                },
              ],
            },
          }),
        )
      }
      if (url.endsWith('/api/admin/seating-imports/schemes/stage')) {
        return Promise.resolve(
          response({
            id: 'scheme-import-7',
            sourceFileId: 'pdf-file-7',
            registryImportId: 'registry-import-7',
            registryRowIndex: 0,
            sha256: 'P'.repeat(64),
            adapter: 'G31OfficialHallScheme',
            adapterVersion: 'v1',
            state: 'PendingReview',
            stagedAt: '2026-09-25T09:15:00Z',
            hall: {
              venueNameHy: '',
              venueNameRu: 'Опера',
              venueNameEn: 'Opera',
              hallNameHy: '',
              hallNameRu: 'Большой зал',
              hallNameEn: 'Main Hall',
            },
          }),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const { container } = render(
      <LabProvider>
        <RegistryPage />
      </LabProvider>,
    )
    const inputs =
      container.querySelectorAll<HTMLInputElement>('input[type="file"]')
    fireEvent.change(inputs[0], {
      target: {
        files: [new File(['xlsx'], 'registry.xlsx', { type: xlsxContentType })],
      },
    })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Сохранить на выверку' }),
    )
    expect(
      (await screen.findAllByText('registry-import-7')).length,
    ).toBeGreaterThan(0)

    const pdfInput = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept^=".pdf"]',
    )
    if (!pdfInput) throw new Error('PDF input is missing')
    expect(pdfInput.disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
    expect(pdfInput.disabled).toBe(false)
    fireEvent.change(pdfInput, {
      target: {
        files: [
          new File(['pdf bytes'], 'opera.pdf', { type: 'application/pdf' }),
        ],
      },
    })

    await waitFor(() =>
      expect(
        calls.some((call) =>
          call.url.endsWith('/api/admin/seating-imports/schemes/stage'),
        ),
      ).toBe(true),
    )
    expect(await screen.findByText('scheme-import-7')).toBeTruthy()
    expect(pdfInput.disabled).toBe(true)
    expect(screen.getByText('P'.repeat(64))).toBeTruthy()
    expect(screen.getByText(/registry-import-7 · rowIndex 0/)).toBeTruthy()
    expect(screen.getAllByText('PendingReview').length).toBeGreaterThan(0)
    const request = calls.find((call) =>
      call.url.endsWith('/api/admin/seating-imports/schemes/stage'),
    )
    expect(request?.init?.method).toBe('POST')
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      sourceFileId: 'pdf-file-7',
      registryImportId: 'registry-import-7',
      registryRowIndex: 0,
    })
    expect(
      (request?.init?.headers as Record<string, string>)['Idempotency-Key'],
    ).toBeTruthy()
    expect(
      calls.some(
        (call) => call.url.includes('/publish') || call.url.includes('/apply'),
      ),
    ).toBe(false)
  })

  it('restores a staged XLSX report and linked PDF after the page is reopened', async () => {
    stubConnection()
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (
        url.endsWith('/api/admin/seating-imports/registry/xlsx-file-restore')
      ) {
        return Promise.resolve(
          response({
            id: 'registry-import-restore',
            sourceFileId: 'xlsx-file-restore',
            uploadedBySubjectId: 'admin-1',
            sha256: 'R'.repeat(64),
            adapter: 'G31OfficialHallRegistry',
            adapterVersion: 'v2',
            state: 'PendingReview',
            stagedAt: '2026-09-25T09:00:00Z',
            report: {
              version: 'v2',
              diagnostics: [],
              rows: [
                {
                  venueNameHy: '',
                  venueNameRu: 'Опера',
                  venueNameEn: 'Opera',
                  hallNameHy: '',
                  hallNameRu: 'Большой зал',
                  hallNameEn: 'Main Hall',
                  officialSeatCapacity: 620,
                  officialSchemeFile: 'opera.pdf',
                  addressHy: '',
                  addressRu: '',
                  addressEn: '',
                  officialWebsite: '',
                  phone: '',
                  email: '',
                  contactSource: '',
                  verificationNote: '',
                },
              ],
            },
          }),
        )
      }
      if (url.endsWith('/api/admin/seating-imports/schemes/pdf-file-restore')) {
        return Promise.resolve(
          response({
            id: 'scheme-import-restore',
            sourceFileId: 'pdf-file-restore',
            registryImportId: 'registry-import-restore',
            registryRowIndex: 0,
            sha256: 'S'.repeat(64),
            adapter: 'G31OfficialHallScheme',
            adapterVersion: 'v1',
            state: 'PendingReview',
            stagedAt: '2026-09-25T09:15:00Z',
            hall: {
              venueNameHy: '',
              venueNameRu: 'Опера',
              venueNameEn: 'Opera',
              hallNameHy: '',
              hallNameRu: 'Большой зал',
              hallNameEn: 'Main Hall',
            },
          }),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    render(
      <LabProvider>
        <RegistryPage />
      </LabProvider>,
    )
    fireEvent.change(screen.getByLabelText('ID XLSX-файла'), {
      target: { value: 'xlsx-file-restore' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить XLSX' }))
    expect(await screen.findByRole('combobox')).toBeTruthy()
    expect(
      screen.getAllByText('registry-import-restore').length,
    ).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('ID PDF-файла'), {
      target: { value: 'pdf-file-restore' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить PDF' }))
    expect(await screen.findByText('scheme-import-restore')).toBeTruthy()
    expect(screen.getByText('S'.repeat(64))).toBeTruthy()
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.test/api/admin/seating-imports/registry/xlsx-file-restore',
      'https://api.test/api/admin/seating-imports/schemes/pdf-file-restore',
    ])
  })

  it('clears the previous row and PDF recovery id when switching XLSX imports', async () => {
    stubConnection()
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/admin/seating-imports/registry/xlsx-a'))
        return Promise.resolve(
          stagedRegistryResponse('xlsx-a', 'import-a', 'A'),
        )
      if (url.endsWith('/api/admin/seating-imports/registry/xlsx-b'))
        return Promise.resolve(
          stagedRegistryResponse('xlsx-b', 'import-b', 'B'),
        )
      if (url.endsWith('/api/admin/seating-imports/schemes/pdf-a'))
        return Promise.resolve(stagedSchemeResponse('pdf-a', 'import-a', 0))
      throw new Error(`Unexpected request: ${url}`)
    })

    const { container } = render(
      <LabProvider>
        <RegistryPage />
      </LabProvider>,
    )
    fireEvent.change(screen.getByLabelText('ID XLSX-файла'), {
      target: { value: 'xlsx-a' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить XLSX' }))
    expect(await screen.findByRole('combobox')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('ID PDF-файла'), {
      target: { value: 'pdf-a' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить PDF' }))
    expect(await screen.findByText('scheme-import-pdf-a')).toBeTruthy()
    const rowOption = screen
      .getByRole('combobox')
      .querySelector('option[value="0"]')
    expect((rowOption as HTMLOptionElement | null)?.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('ID PDF-файла'), {
      target: { value: 'pdf-not-yet-restored' },
    })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })

    fireEvent.change(screen.getByLabelText('ID XLSX-файла'), {
      target: { value: 'xlsx-b' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить XLSX' }))

    await waitFor(() =>
      expect(
        screen.getByRole('combobox').querySelector('option[value="0"]')
          ?.textContent,
      ).toContain('B площадка 1'),
    )
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
    expect(
      (screen.getByLabelText('ID PDF-файла') as HTMLInputElement).value,
    ).toBe('')
    const pdfInput = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept^=".pdf"]',
    )
    expect(pdfInput?.disabled).toBe(true)
  })

  it('retries a failed PDF stage without reuploading and reuses the key only for the same mapping', async () => {
    stubConnection()
    const calls: { url: string; init?: RequestInit }[] = []
    let stageCount = 0
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/api/admin/seating-imports/registry/xlsx-retry'))
        return Promise.resolve(
          stagedRegistryResponse('xlsx-retry', 'import-retry', 'Retry'),
        )
      if (url.endsWith('/api/files/upload-requests'))
        return Promise.resolve(
          response({
            fileId: 'pdf-retry',
            fileName: 'retry.pdf',
            contentType: 'application/pdf',
            uploadUrl: 'https://storage.test/pdf-retry',
            method: 'PUT',
            expiresAt: '2026-09-27T00:00:00Z',
          }),
        )
      if (url === 'https://storage.test/pdf-retry')
        return Promise.resolve(response(null))
      if (url.endsWith('/api/admin/seating-imports/schemes/stage')) {
        stageCount += 1
        if (stageCount < 3)
          return Promise.resolve(failedResponse(503, 'Temporary failure'))
        return Promise.resolve(
          stagedSchemeResponse('pdf-retry', 'import-retry', 1),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const { container } = render(
      <LabProvider>
        <RegistryPage />
      </LabProvider>,
    )
    fireEvent.change(screen.getByLabelText('ID XLSX-файла'), {
      target: { value: 'xlsx-retry' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить XLSX' }))
    await screen.findByRole('combobox')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
    const pdfInput = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept^=".pdf"]',
    )
    if (!pdfInput) throw new Error('PDF input is missing')
    fireEvent.change(pdfInput, {
      target: {
        files: [
          new File(['PDF bytes'], 'retry.pdf', { type: 'application/pdf' }),
        ],
      },
    })

    expect(await screen.findByText(/PDF уже загружен: retry\.pdf/)).toBeTruthy()
    expect(screen.getByText('pdf-retry')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Повторить сохранение' }),
    )
    await waitFor(() => expect(stageCount).toBe(2))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Связать PDF с выбранной строкой' }),
    )
    expect(await screen.findByText('scheme-import-pdf-retry')).toBeTruthy()

    const schemeRequests = calls.filter((call) =>
      call.url.endsWith('/api/admin/seating-imports/schemes/stage'),
    )
    expect(schemeRequests).toHaveLength(3)
    const requestBodies = schemeRequests.map((call) =>
      JSON.parse(String(call.init?.body)),
    )
    expect(requestBodies[0]).toEqual({
      sourceFileId: 'pdf-retry',
      registryImportId: 'import-retry',
      registryRowIndex: 0,
    })
    expect(requestBodies[1]).toEqual(requestBodies[0])
    expect(requestBodies[2]).toEqual({
      ...requestBodies[0],
      registryRowIndex: 1,
    })
    const keys = schemeRequests.map(
      (call) =>
        (call.init?.headers as Record<string, string>)['Idempotency-Key'],
    )
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
    expect(
      calls.filter((call) => call.url.endsWith('/api/files/upload-requests')),
    ).toHaveLength(1)
    expect(
      calls.filter((call) => call.url === 'https://storage.test/pdf-retry'),
    ).toHaveLength(1)
  })

  it('shows the actual parent import on a PDF recovery mismatch and keeps its file id', async () => {
    stubConnection()
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/admin/seating-imports/registry/current-xlsx'))
        return Promise.resolve(
          stagedRegistryResponse('current-xlsx', 'current-import', 'Current'),
        )
      if (url.endsWith('/api/admin/seating-imports/schemes/other-pdf'))
        return Promise.resolve(
          stagedSchemeResponse('other-pdf', 'actual-parent-import', 0),
        )
      throw new Error(`Unexpected request: ${url}`)
    })
    render(
      <LabProvider>
        <RegistryPage />
      </LabProvider>,
    )
    fireEvent.change(screen.getByLabelText('ID XLSX-файла'), {
      target: { value: 'current-xlsx' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить XLSX' }))
    await screen.findByRole('combobox')
    fireEvent.change(screen.getByLabelText('ID PDF-файла'), {
      target: { value: 'other-pdf' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить PDF' }))
    expect(
      await screen.findByText(/связана с XLSX импортом actual-parent-import/),
    ).toBeTruthy()
    expect(
      (screen.getByLabelText('ID PDF-файла') as HTMLInputElement).value,
    ).toBe('other-pdf')
  })
})
