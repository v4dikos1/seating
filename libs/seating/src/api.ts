import type {
  FloorCalibration,
  SeatingProperties,
  SeatingZoneGeometry,
  SeatingZoneKind,
} from './model'

/** Ответы и запросы повторяют Backend/docs/guides/seating-configurator.md. */
export interface PagedResult<T> {
  items: T[]
  totalItems: number
  offset: number
  limit: number
}

export interface VenueSpaceListResult {
  id: string
  venue: { id: string; name: string }
  name: string
  createdAt: string
}

/**
 * Помещение со стороны администратора справочника. Собственной архивации у помещения нет:
 * оно архивно ровно настолько, насколько архивна его площадка, и признак приходит из неё.
 */
export interface AdminVenueSpaceResult extends VenueSpaceListResult {
  venueArchivedAt: string | null
}

export type Language = 'Hy' | 'Ru' | 'En'

export interface CityResult {
  id: string
  name: string
  language: Language
  centerLatitude: number | null
  centerLongitude: number | null
}

/** Площадка платформенного справочника со стороны администратора. */
export interface VenueResult {
  id: string
  code: string
  cityId: string
  name: string
  address: string
  language: Language
  latitude: number
  longitude: number
  archivedAt: string | null
}

export interface CreateVenueBody {
  cityId: string
  name: string
  address: string
  sourceLanguage: Language
  latitude: number
  longitude: number
  code?: string | null
  timeZone?: string | null
}

export interface UpdateVenueBody {
  name?: string | null
  address?: string | null
  cityId?: string | null
  code?: string | null
  latitude?: number | null
  longitude?: number | null
}

/** Анонимный справочник площадок: нужен, чтобы выбрать venueId, а не вводить его руками. */
export interface PublicVenueResult {
  id: string
  code: string
  cityId: string
  name: string
  address: string
  language: 'Hy' | 'Ru' | 'En'
  latitude: number
  longitude: number
}

export interface SeatingConfigurationResult {
  id: string
  space: { id: string; name: string }
  venue: { id: string; name: string }
  organizerId: string
  name: string
  versions: SeatingConfigurationVersions
  createdAt: string
  updatedAt: string
  /** Умолчания конфигурации — последний уровень наследования свойств. */
  properties?: SeatingProperties | null
}

/** Токены карточки; до первой правки геометрии редакции нет. */
export interface SeatingConfigurationVersions {
  configurationVersion: number
  configurationRevision?: number | null
}

/** Токены этажа; редакция отсутствует у этажа нового черновика. */
export interface SeatingFloorVersions {
  floorVersion: number
  configurationVersion: number
  configurationRevision?: number | null
}

/** Токены зоны в списке выбранной редакции. */
export interface SeatingZoneListVersions {
  zoneVersion: number
  compositionVersion: number
  configurationRevision: number
}

/** Токены полной зоны и карточки её конфигурации. */
export interface SeatingZoneVersions extends SeatingZoneListVersions {
  configurationVersion: number
}

export interface FloorPlacement {
  originX: number
  originY: number
  rotationDegrees: number
}

export interface SeatingFloorBackground {
  file: FileDownloadResult
  page: number
  calibration: FloorCalibration | null
  placement: FloorPlacement
}

/** Устойчивый этаж с явным измерением масштаба и размещением PDF. */
export interface SeatingFloorResult {
  configurationId: string
  id: string
  name: string
  versions: SeatingFloorVersions
  isDefault: boolean
  background: SeatingFloorBackground | null
}

export type SeatingFloorSavedResult = SeatingFloorResult

export interface FileUploadRequestResult {
  fileId: string
  fileName: string
  contentType: string
  uploadUrl: string
  method: 'PUT'
  expiresAt: string
}

export interface FileDownloadResult {
  fileId: string
  fileName: string
  contentType: string
  sizeBytes: number
  dominantColors: string[]
  url: string
  urlExpiresAt: string
}

/** Одна строка официального реестра залов и неподтверждённые подсказки каталога. */
export interface OfficialHallRegistryRow {
  venueNameHy: string
  venueNameRu: string
  venueNameEn: string
  hallNameHy: string
  hallNameRu: string
  hallNameEn: string
  officialSeatCapacity: number | null
  officialSchemeFile: string
  addressHy: string
  addressRu: string
  addressEn: string
  officialWebsite: string
  phone: string
  email: string
  contactSource: string
  verificationNote: string
  /** Exact-name catalog hints only; an administrator must confirm identity manually. */
  match: OfficialHallRegistryMatch
}

export interface OfficialHallRegistryMatch {
  venueCandidates: string[]
  venueSpaceCandidates: string[]
  requiresManualConfirmation: boolean
  diagnostics: OfficialHallRegistryMatchDiagnostic[]
}

export interface OfficialHallRegistryMatchDiagnostic {
  code: string
  message: string
}

/** Замечание к структуре реестра: код, номер строки XLSX и пояснение администратору. */
export interface OfficialHallRegistryDiagnostic {
  code: string
  row: number | null
  message: string
}

export interface OfficialHallRegistryPreviewResult {
  fileId: string
  fileName: string
  sha256: string
  version: string | null
  catalogMatchingAvailable: boolean
  rows: OfficialHallRegistryRow[]
  diagnostics: OfficialHallRegistryDiagnostic[]
}

export interface OfficialHallRegistryStageReport {
  version: string
  rows: Omit<OfficialHallRegistryRow, 'match'>[]
  diagnostics: OfficialHallRegistryDiagnostic[]
}

export interface OfficialHallRegistryStageResult {
  id: string
  sourceFileId: string
  uploadedBySubjectId: string
  sha256: string
  adapter: 'G31OfficialHallRegistry' | 'G31OfficialHallScheme'
  adapterVersion: string
  state: 'PendingReview'
  stagedAt: string
  report: OfficialHallRegistryStageReport
}

/** Схема зала загружена вместе с явной ссылкой на строку сохранённого XLSX реестра. */
export interface OfficialHallSchemeStageResult {
  id: string
  sourceFileId: string
  registryImportId: string
  registryRowIndex: number
  sha256: string
  adapter: 'G31OfficialHallRegistry' | 'G31OfficialHallScheme'
  adapterVersion: string
  state: 'PendingReview'
  stagedAt: string
  hall: Pick<
    OfficialHallRegistryRow,
    | 'venueNameHy'
    | 'venueNameRu'
    | 'venueNameEn'
    | 'hallNameHy'
    | 'hallNameRu'
    | 'hallNameEn'
  >
}

/**
 * Проверка загруженного PDF схемы до его фиксации за строкой реестра
 * (`GetOfficialHallSchemeSource`, Backend/src/Application/Management/SeatingConfigurations).
 * Сервер ничего не создаёт и не запоминает — только пересчитывает SHA-256 фактических
 * байтов файла, чтобы показать его до необратимого шага «Связать со строкой».
 */
export interface OfficialHallSchemeSourceResult {
  sourceFileId: string
  sha256: string
}

export const xlsxContentType =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const pdfContentType = 'application/pdf'

export interface SeatingZoneListResult {
  configurationId: string
  zoneId: string
  floorId: string
  versions: SeatingZoneListVersions
  code: string
  name: string
  color: string
  kind: SeatingZoneKind
  capacity: number | null
  x: number
  y: number
  width: number
  height: number
}

export interface SeatingZoneResult {
  configurationId: string
  zoneId: string
  floorId: string
  versions: SeatingZoneVersions
  geometry: SeatingZoneGeometry
}

/**
 * Удаление зоны дописывает новую редакцию черновика без неё: история и UUID мест
 * прежних редакций сохраняются, а сама зона пропадает из состава текущей.
 */
export interface DeletedSeatingZoneResult {
  configurationId: string
  zoneId: string
  floorId: string
  versions: SeatingZoneVersions
}

/**
 * Прогон проверки схемы на сервере (артефакт 14 §11). Валидатор принадлежит ядру,
 * поэтому серверный ответ — источник истины; клиентский проход в `validation.ts`
 * нужен, чтобы показывать находки во время правки, не обращаясь к серверу на каждый ход.
 */
export interface SeatingValidationFindingResult {
  level: 'Critical' | 'Warning'
  code: 'ZonesOverlap' | 'EmptyZone' | 'NumberingGap' | 'SeatsOverlap' | 'RowsCross'
  zoneId: string
  relatedZoneId: string | null
  firstPairCoordinates?: Array<{ x: number; y: number }> | null
  message: string
}

export interface SeatingValidationResult {
  configurationId: string
  revision: number | null
  findings: SeatingValidationFindingResult[]
  /** Сервер достиг лимита 1000 находок; полный результат проверки неизвестен. */
  isTruncated: boolean
}

export type SortDirection = 'Asc' | 'Desc'

export interface PageParams {
  offset?: number
  limit?: number
  searchQuery?: string
  sortDirection?: SortDirection
}

export interface VenueSpaceParams extends PageParams {
  venueId?: string
  sortBy?: 'Name' | 'Id'
}

export interface AdminVenueSpaceParams extends VenueSpaceParams {
  includeArchived?: boolean
}

export interface PublicVenueParams extends PageParams {
  cityId?: string
  language?: 'Hy' | 'Ru' | 'En'
  sortBy?: 'Name' | 'Code' | 'Id'
}

export interface ConfigurationParams extends PageParams {
  organizerId?: string
  spaceId?: string
  sortBy?: 'Name' | 'UpdatedAt'
}

export interface ZoneParams extends PageParams {
  revision?: number
  floorId?: string
  kind?: SeatingZoneKind
  sortBy?: 'Code' | 'Name'
}

export interface FloorParams extends PageParams {
  revision?: number
  sortBy?: 'Name' | 'Id'
}

/** Запись обмена для журнала стенда: видно, какой маршрут и с каким ключом повтора вызван. */
export interface ApiExchange {
  id: number
  at: string
  method: string
  path: string
  status: number
  ok: boolean
  ms: number
  idempotencyKey?: string
  errorCode?: string
  detail?: string
}

/** RFC 7807 из `Failure.ToProblem`: errorCode и errors приходят расширениями. */
export class SeatingApiError extends Error {
  readonly status: number
  readonly errorCode?: string
  readonly detail?: string
  readonly traceId?: string
  readonly errors?: Record<string, string[]>
  readonly currentTotal?: { amountMinor: number; currency: string }

  constructor(
    status: number,
    body: Record<string, unknown> | null,
    fallback: string,
  ) {
    const detail =
      typeof body?.['detail'] === 'string'
        ? (body['detail'] as string)
        : undefined
    const title =
      typeof body?.['title'] === 'string'
        ? (body['title'] as string)
        : undefined
    super(detail || title || fallback)
    this.name = 'SeatingApiError'
    this.status = status
    this.detail = detail
    this.errorCode =
      typeof body?.['errorCode'] === 'string'
        ? (body['errorCode'] as string)
        : undefined
    this.traceId =
      typeof body?.['traceId'] === 'string'
        ? (body['traceId'] as string)
        : undefined
    this.errors =
      (body?.['errors'] as Record<string, string[]> | undefined) ?? undefined
    const currentTotal = body?.['currentTotal']
    if (currentTotal && typeof currentTotal === 'object') {
      const money = currentTotal as Record<string, unknown>
      if (typeof money['amountMinor'] === 'number' && typeof money['currency'] === 'string')
        this.currentTotal = { amountMinor: money['amountMinor'], currency: money['currency'] }
    }
  }
}

export interface SeatingApiOptions {
  baseUrl: string
  token?: string | null
  onExchange?: (exchange: ApiExchange) => void
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? '?' + text : ''
}

let sequence = 0

export class SeatingApi {
  private readonly options: SeatingApiOptions

  constructor(options: SeatingApiOptions) {
    this.options = options
  }

  private async send<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    if (this.options.token)
      headers['Authorization'] = 'Bearer ' + this.options.token
    const started = performance.now()
    const url = this.options.baseUrl.replace(/\/+$/, '') + path
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (reason) {
      this.record({
        id: ++sequence,
        at: new Date().toISOString(),
        method,
        path,
        status: 0,
        ok: false,
        ms: performance.now() - started,
        idempotencyKey,
        detail: reason instanceof Error ? reason.message : String(reason),
      })
      throw new SeatingApiError(
        0,
        null,
        'Сеть недоступна или запрос отклонён браузером: ' +
          (reason instanceof Error ? reason.message : String(reason)),
      )
    }
    const ms = performance.now() - started
    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }
    if (!response.ok) {
      const problem = (parsed ?? null) as Record<string, unknown> | null
      const error = new SeatingApiError(
        response.status,
        problem,
        'HTTP ' + response.status,
      )
      this.record({
        id: ++sequence,
        at: new Date().toISOString(),
        method,
        path,
        status: response.status,
        ok: false,
        ms,
        idempotencyKey,
        errorCode: error.errorCode,
        detail: error.message,
      })
      throw error
    }
    this.record({
      id: ++sequence,
      at: new Date().toISOString(),
      method,
      path,
      status: response.status,
      ok: true,
      ms,
      idempotencyKey,
    })
    return parsed as T
  }

  private record(exchange: ApiExchange): void {
    this.options.onExchange?.(exchange)
  }

  /** Анонимный маршрут: работает и без токена, поэтому площадку видно до входа. */
  listPublicVenues(
    params: PublicVenueParams = {},
  ): Promise<PagedResult<PublicVenueResult>> {
    return this.send('GET', '/api/public/venues' + query({ ...params }))
  }

  listCities(
    params: PageParams & { language?: Language } = {},
  ): Promise<PagedResult<CityResult>> {
    return this.send('GET', '/api/public/cities' + query({ ...params }))
  }

  /** Справочник площадок администратора: платформенное VenueRead. */
  listVenues(
    params: PageParams & {
      cityId?: string
      includeArchived?: boolean
      language?: Language
    } = {},
  ): Promise<PagedResult<VenueResult>> {
    return this.send('GET', '/api/admin/venues' + query({ ...params }))
  }

  createVenue(body: CreateVenueBody, key: string): Promise<VenueResult> {
    return this.send('POST', '/api/admin/venues', body, key)
  }

  updateVenue(
    id: string,
    body: UpdateVenueBody,
    key: string,
  ): Promise<VenueResult> {
    return this.send('PATCH', '/api/admin/venues/' + id, body, key)
  }

  archiveVenue(id: string, key: string): Promise<void> {
    return this.send('DELETE', '/api/admin/venues/' + id, undefined, key)
  }

  /** Организаторское SeatingRead: администратору платформы маршрут отвечает 403. */
  listVenueSpaces(
    params: VenueSpaceParams = {},
  ): Promise<PagedResult<VenueSpaceListResult>> {
    return this.send('GET', '/api/venue-spaces' + query({ ...params }))
  }

  /**
   * Тот же справочник для администратора: платформенное VenueRead вместо членства
   * в организации. Помещения архивных площадок скрыты, пока их не попросит includeArchived.
   */
  listAdminVenueSpaces(
    params: AdminVenueSpaceParams = {},
  ): Promise<PagedResult<AdminVenueSpaceResult>> {
    return this.send('GET', '/api/admin/venue-spaces' + query({ ...params }))
  }

  /** Платформенное полномочие VenueManage; организатору маршрут отвечает 403. */
  createVenueSpace(
    body: { venueId: string; name: string },
    key: string,
  ): Promise<VenueSpaceListResult> {
    return this.send('POST', '/api/admin/venue-spaces', body, key)
  }

  listConfigurations(
    params: ConfigurationParams = {},
  ): Promise<PagedResult<SeatingConfigurationResult>> {
    return this.send(
      'GET',
      '/api/seating-configurations' + query({ ...params }),
    )
  }

  createConfiguration(
    body: { spaceId: string; name: string },
    key: string,
  ): Promise<SeatingConfigurationResult> {
    return this.send('POST', '/api/seating-configurations', body, key)
  }

  getConfiguration(id: string): Promise<SeatingConfigurationResult> {
    return this.send('GET', '/api/seating-configurations/' + id)
  }

  renameConfiguration(
    id: string,
    body: { expectedVersion: number; name?: string | null },
    key: string,
  ): Promise<SeatingConfigurationResult> {
    return this.send('PATCH', '/api/seating-configurations/' + id, body, key)
  }

  listZones(
    id: string,
    params: ZoneParams = {},
  ): Promise<PagedResult<SeatingZoneListResult>> {
    return this.send(
      'GET',
      '/api/seating-configurations/' + id + '/zones' + query({ ...params }),
    )
  }

  /** Прогон проверки схемы по сохранённому составу редакции. */
  validateConfiguration(
    id: string,
    revision?: number | null,
  ): Promise<SeatingValidationResult> {
    return this.send(
      'GET',
      '/api/seating-configurations/' + id + '/validation' + query({ revision }),
    )
  }

  listFloors(
    id: string,
    params: FloorParams = {},
  ): Promise<PagedResult<SeatingFloorResult>> {
    return this.send(
      'GET',
      '/api/seating-configurations/' + id + '/floors' + query({ ...params }),
    )
  }

  getFloor(
    id: string,
    floorId: string,
    revision?: number,
  ): Promise<SeatingFloorResult> {
    return this.send(
      'GET',
      '/api/seating-configurations/' +
        id +
        '/floors/' +
        floorId +
        query({ revision }),
    )
  }

  createFloor(
    id: string,
    body: { expectedVersion: number; name: string },
    key: string,
  ): Promise<SeatingFloorResult> {
    return this.send(
      'POST',
      '/api/seating-configurations/' + id + '/floors',
      body,
      key,
    )
  }

  updateFloor(
    id: string,
    floorId: string,
    body: {
      expectedFloorVersion: number
      name?: string
      background?: {
        file?: string
        page?: number
        calibration?: FloorCalibration | null
        placement?: Partial<FloorPlacement>
      } | null
    },
    key: string,
  ): Promise<SeatingFloorResult> {
    const background = body.background
    const request = { expectedFloorVersion: body.expectedFloorVersion,
      ...(body.name !== undefined ? { name: body.name } : {}) }
    const calibration = background?.calibration;
    const round = (value: number) => Math.round(value * 10_000) / 10_000;
    return this.send(
      'PATCH',
      '/api/seating-configurations/' + id + '/floors/' + floorId,
      calibration ? {
        ...request,
        background: {
          ...background,
          calibration: {
            point1: { x: round(calibration.point1.x), y: round(calibration.point1.y) },
            point2: { x: round(calibration.point2.x), y: round(calibration.point2.y) },
            distanceMeters: round(calibration.distanceMeters),
          },
        },
      } : { ...request, ...(background !== undefined ? { background } : {}) },
      key,
    )
  }

  requestFileUpload(
    body: { fileName: string; contentType: string },
    key: string,
  ): Promise<FileUploadRequestResult> {
    return this.send('POST', '/api/files/upload-requests', body, key)
  }

  async uploadFile(
    file: File,
    key: string,
    contentType = file.type,
  ): Promise<string> {
    const request = await this.requestFileUpload(
      { fileName: file.name, contentType },
      key,
    )
    const response = await fetch(request.uploadUrl, {
      method: request.method,
      headers: { 'Content-Type': request.contentType },
      body: file,
    })
    if (!response.ok)
      throw new SeatingApiError(
        response.status,
        null,
        'Не удалось загрузить файл.',
      )
    return request.fileId
  }

  getZone(
    id: string,
    zoneId: string,
    revision?: number | null,
  ): Promise<SeatingZoneResult> {
    return this.send(
      'GET',
      '/api/seating-configurations/' +
        id +
        '/zones/' +
        zoneId +
        query({ revision }),
    )
  }

  createZone(
    id: string,
    body: { expectedVersion: number; geometry: SeatingZoneGeometry },
    key: string,
  ): Promise<SeatingZoneResult> {
    return this.send(
      'POST',
      '/api/seating-configurations/' + id + '/zones',
      body,
      key,
    )
  }

  saveZone(
    id: string,
    zoneId: string,
    body: { expectedZoneVersion: number; geometry: SeatingZoneGeometry },
    key: string,
  ): Promise<SeatingZoneResult> {
    return this.send(
      'PUT',
      '/api/seating-configurations/' + id + '/zones/' + zoneId,
      body,
      key,
    )
  }

  /**
   * Правка атрибутов зоны без её состава: сервер создаёт новый снимок атрибутов над прежней
   * версией состава, поэтому стоимость запроса не зависит от числа мест. Присланный
   * `properties: null` снимает объявление зоны, отсутствие поля сохраняет прежнее.
   */
  patchZone(
    id: string,
    zoneId: string,
    body: {
      expectedZoneVersion: number
      code?: string
      name?: string
      color?: string
      capacity?: number
      properties?: SeatingProperties | null
    },
    key: string,
  ): Promise<SeatingZoneResult> {
    return this.send(
      'PATCH',
      '/api/seating-configurations/' + id + '/zones/' + zoneId,
      body,
      key,
    )
  }

  /**
   * Убрать зону из черновика: сервер дописывает новую редакцию без неё, историю и UUID
   * мест не трогает. `expectedZoneVersion` — тот же оптимистический токен, что и у
   * `saveZone`/`patchZone`; расхождение отвечает 409 (RFC 7807).
   */
  deleteZone(
    id: string,
    zoneId: string,
    expectedZoneVersion: number,
    key: string,
  ): Promise<DeletedSeatingZoneResult> {
    return this.send(
      'DELETE',
      '/api/seating-configurations/' +
        id +
        '/zones/' +
        zoneId +
        query({ expectedZoneVersion }),
      undefined,
      key,
    )
  }

  /** Read-only preview: rows, parser diagnostics, and advisory catalog match candidates. */
  previewHallRegistry(
    fileId: string,
  ): Promise<OfficialHallRegistryPreviewResult> {
    return this.send(
      'GET',
      '/api/admin/seating-imports/registry/' + fileId + '/preview',
    )
  }

  /** Save a validated official registry report for manual review, without publishing catalog data. */
  stageHallRegistry(
    fileId: string,
    key: string,
  ): Promise<OfficialHallRegistryStageResult> {
    return this.send(
      'POST',
      '/api/admin/seating-imports/registry/' + fileId + '/stage',
      undefined,
      key,
    )
  }

  /** Read a staged XLSX report so a platform admin can explicitly map a hall scheme to one row. */
  getStagedHallRegistry(
    fileId: string,
  ): Promise<OfficialHallRegistryStageResult> {
    return this.send('GET', '/api/admin/seating-imports/registry/' + fileId)
  }

  /** Stage one PDF as a review candidate linked to an explicitly selected registry row. */
  stageOfficialHallScheme(
    body: {
      sourceFileId: string
      registryImportId: string
      registryRowIndex: number
    },
    key: string,
  ): Promise<OfficialHallSchemeStageResult> {
    return this.send(
      'POST',
      '/api/admin/seating-imports/schemes/stage',
      body,
      key,
    )
  }

  /** Restore the staged review record for a known uploaded PDF file id. */
  getStagedHallScheme(
    pdfFileId: string,
  ): Promise<OfficialHallSchemeStageResult> {
    return this.send('GET', '/api/admin/seating-imports/schemes/' + pdfFileId)
  }

  /**
   * Проверить фактические байты загруженного PDF до фиксации схемы за строкой реестра:
   * SHA-256 фактического файла, ничего не сохраняя и не создавая (`preview`, не `stage`).
   */
  previewOfficialHallSchemeSource(
    sourceFileId: string,
  ): Promise<OfficialHallSchemeSourceResult> {
    return this.send(
      'GET',
      '/api/admin/seating-imports/schemes/' + sourceFileId + '/preview',
    )
  }

  /** Умолчания конфигурации: тело и есть запись целиком, поэтому PUT. */
  setConfigurationProperties(
    id: string,
    body: { expectedVersion: number; properties: SeatingProperties | null },
    key: string,
  ): Promise<SeatingConfigurationResult> {
    return this.send(
      'PUT',
      '/api/seating-configurations/' + id + '/properties',
      body,
      key,
    )
  }
}

/** Пароль не сохраняется: стенду нужен только полученный access token. */
export async function requestKeycloakToken(input: {
  authUrl: string
  realm: string
  clientId: string
  clientSecret?: string
  username: string
  password: string
  scope?: string
}): Promise<{ accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: input.clientId,
    username: input.username,
    password: input.password,
    scope: input.scope || 'openid profile email',
  })
  if (input.clientSecret) body.set('client_secret', input.clientSecret)
  const url =
    input.authUrl.replace(/\/+$/, '') +
    '/realms/' +
    encodeURIComponent(input.realm) +
    '/protocol/openid-connect/token'
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch (reason) {
    // Браузер отбрасывает ответ до его чтения, когда origin страницы не разрешён клиенту
    // Keycloak: снаружи это неотличимо от недоступной сети, поэтому называем обе причины.
    throw new Error(
      'Keycloak не ответил браузеру (' +
        (reason instanceof Error ? reason.message : String(reason)) +
        '). Обычно это значит, что адрес этой страницы не входит в Web Origins клиента «' +
        input.clientId +
        '» либо realm недоступен. Токен можно вставить вручную.',
    )
  }
  const text = await response.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    parsed = {}
  }
  if (!response.ok)
    throw new Error(
      'Keycloak ' +
        response.status +
        ': ' +
        String(
          parsed['error_description'] ?? parsed['error'] ?? text.slice(0, 200),
        ),
    )
  return {
    accessToken: String(parsed['access_token'] ?? ''),
    expiresIn: Number(parsed['expires_in'] ?? 0),
  }
}

/** Полномочия субъекта видны в самом токене: это подсказка стенда, а не проверка доступа. */
export function decodeTokenClaims(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    )
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}
