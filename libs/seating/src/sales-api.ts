import type { SeatingZoneGeometry, SeatingZoneKind } from './model'
import {
  SeatingApiError,
  type ApiExchange,
  type PageParams,
  type PagedResult,
  type SeatingApiOptions,
} from './api'

/**
 * Клиент API продаж. Денежные значения передаются объектом `{ amountMinor, currency }`,
 * идентификаторы ресурсов — UUID, а имена полей в JSON — camelCase.
 */

// --- Деньги и общие перечисления --------------------------------------------

/** Мультивалютности нет: `Money.Currency` на сервере — только `"AMD"`. */
export type SalesCurrency = 'AMD'

export interface SalesMoney { amountMinor: number; currency: SalesCurrency }
export interface SalesPeriod { from: string | null; to: string | null }
export interface SalesZoneLink { id: string; code: string; name: string }
export interface SalesSeatAddress { zone: SalesZoneLink; row: string | null; table: string | null; seat: string }
export interface SalesOccurrenceLink { id: string; name: string; startsAt: string }

/** `Domain.Enums.PriceRuleKind`. */
export type PriceRuleKind = 'PercentDiscount' | 'FixedDiscount' | 'PercentMarkup' | 'FixedMarkup'

/** `Domain.Enums.ReservationStatus`. */
export type ReservationStatus = 'Active' | 'Committed' | 'Expired' | 'Released'

/** `Domain.Enums.SalesOrderStatus`. */
export type SalesOrderStatus = 'Created' | 'PendingPayment' | 'Paid' | 'Cancelled' | 'Expired'

/** `Domain.Enums.PaymentAttemptStatus`. */
export type PaymentAttemptStatus = 'Initiated' | 'ActionRequired' | 'Captured' | 'Failed' | 'Cancelled'

/** `Domain.Enums.PaymentFailureReason`. */
export type PaymentFailureReason = 'Declined' | 'Expired'

/** `Domain.Enums.PaymentAttemptAdapter`. */
export type PaymentAttemptAdapterKind = 'Mock' | 'ZeroAmount'

/** `Domain.Enums.TicketStatus`: единственный член первого среза. */
export type TicketStatus = 'Issued'

/** `Application.Sales.Inventory.UnitAvailability` — продажное состояние места. */
export type UnitAvailability = 'Available' | 'Held' | 'Sold'

/** `Application.Sales.Orders.MockPaymentOutcome`. */
export type MockPaymentOutcome = 'Succeeded' | 'Declined' | 'Expired'

// --- Схема и доступность показа (Sales/Inventory/OccurrenceSeatingReader.cs) ------------------

/** `OccurrenceZoneOffer`: цена зоны, вычисленная сервером на момент чтения. */
export interface OccurrenceZoneOffer {
  productId: string
  categoryCode: string
  name: string
  basePrice: SalesMoney
  price: SalesMoney
  perOrderLimit: number | null
}

/** `OccurrenceSeatingZone`: зона компоновки показа с геометрией редакции и предложением. */
export interface OccurrenceSeatingZone {
  zoneId: string
  zoneVersion: number
  /** Можно ли бронировать места зоны: вид поддержан и цена назначена. */
  saleable: boolean
  /** Та же форма, что `SeatingZoneResult.geometry` в `api.ts` (`SeatingZoneViews.ToGeometry`). */
  geometry: SeatingZoneGeometry
  /** Отсутствует, если зоне не назначена цена. */
  offer: OccurrenceZoneOffer | null
}

/** `OccurrenceSeatingResult`: схема показа для покупателя (`GET .../seating`). */
export interface OccurrenceSeatingResult {
  occurrenceId: string
  configurationId: string
  configurationRevision: number
  /** 0 — цены ещё не применены. */
  pricingVersion: number
  zones: OccurrenceSeatingZone[]
}

/** `OccurrenceUnitStatus`: публичный статус места без владельца. */
export interface OccurrenceUnitStatus {
  positionId: string
  zoneId: string
  status: UnitAvailability
  version: number
}

export interface AdminOccurrenceUnitStatus extends OccurrenceUnitStatus {
  holderSubjectId: string | null
}

/** `OccurrenceAvailabilityResult` (`GET .../availability`) — снимок статусов без владельцев. */
export interface OccurrenceAvailabilityResult {
  occurrenceId: string
  /** Серверный момент, на который выведены статусы. */
  asOf: string
  units: OccurrenceUnitStatus[]
}

/** `OccurrenceSalesSummary`: `zoneId` отсутствует у сводки всего показа. */
export interface OccurrenceSalesSummary {
  zoneId: string | null
  total: number
  available: number
  held: number
  sold: number
}

/** `OccurrenceSalesResult` (`GET .../sales`, организатор и админ). */
export interface OccurrenceSalesResult {
  asOf: string
  seating: OccurrenceSeatingResult
  units: OccurrenceUnitStatus[]
  summary: OccurrenceSalesSummary
  zones: OccurrenceSalesSummary[]
}

export interface AdminOccurrenceSalesResult extends Omit<OccurrenceSalesResult, 'units'> {
  units: AdminOccurrenceUnitStatus[]
}

// --- Компоновка и цены показа (Sales/OccurrenceLayouts) ------------------------------------

/** `OccurrenceLayoutZoneResult`. */
export interface OccurrenceLayoutZoneResult {
  zoneId: string
  code: string
  name: string
  kind: SeatingZoneKind
  saleable: boolean
  /** Отсутствие любого из двух полей значит «зона не продаётся». */
  productId: string | null
  categoryCode: string | null
}

/** `OccurrenceSalesProductResult`: билетный продукт показа с текущей ценой. */
export interface OccurrenceSalesProductResult {
  productId: string
  categoryCode: string
  name: string
  basePrice: SalesMoney
  perOrderLimit: number | null
}

/** `OccurrenceSalesRuleResult`: действующее правило расчёта цены текущей редакции показа. */
export interface OccurrenceSalesRuleResult {
  ruleNo: number
  kind: PriceRuleKind
  categoryCode: string | null
  value: number
  period: SalesPeriod
  priority: number
}

/**
 * `OccurrenceSalesSetupResult`: общий вид ресурса — привязка компоновки (`PUT .../layout`,
 * `GET .../layout`) и применение цены (`POST .../pricing-applications`) возвращают одну форму.
 */
export interface OccurrenceSalesSetupResult {
  occurrenceId: string
  configurationId: string
  configurationRevision: number
  pricingVersion: number
  sourceTemplateId: string | null
  sourceTemplateVersion: number | null
  zones: OccurrenceLayoutZoneResult[]
  products: OccurrenceSalesProductResult[]
  rules: OccurrenceSalesRuleResult[]
}

export interface BindOccurrenceLayoutBody {
  configurationId: string
  /** Отсутствие выбирает текущую редакцию состава конфигурации. */
  configurationRevision?: number | null
}

export interface ApplyOccurrencePricingZone {
  zoneId: string
  categoryCode: string
}

export interface ApplyOccurrencePricingBody {
  templateId: string
  templateVersion: number
  /** Зона вне списка теряет назначение и перестаёт продаваться. */
  zones: ApplyOccurrencePricingZone[]
}

// --- Бронь (Sales/Inventory: ReservationViews.cs, CreateReservation.cs) --------------------

/** `ReservationItemResult`: снимок цены одного места брони — категории на месте нет. */
export interface ReservationItemResult {
  positionId: string
  productId: string
  address: SalesSeatAddress
  basePrice: SalesMoney
  price: SalesMoney
}

/** `ReservationResult`. */
export interface ReservationResult {
  reservationId: string
  occurrenceId: string
  status: ReservationStatus
  /** Момент истечения по серверным часам. */
  expiresAt: string
  total: SalesMoney
  items: ReservationItemResult[]
}

export interface CreateReservationBody {
  occurrenceId: string
  /** 1..100 позиций (`SalesOptions.MaxPositionsPerReservation`). */
  positionIds: string[]
  /** Сумма, показанная покупателю; расхождение — 409 `SalesPriceChanged` без брони. */
  expectedTotal?: SalesMoney | null
}

// --- Заказ и оплата (Sales/Orders) ----------------------------------------------------------

/** `PaymentAttemptResult`. */
export interface PaymentAttemptResult {
  paymentAttemptId: string
  adapter: PaymentAttemptAdapterKind
  status: PaymentAttemptStatus
  failureReason: PaymentFailureReason | null
  amount: SalesMoney
  /** `true` для адаптера `Mock`: тестовая оплата без настоящего списания. */
  isTest: boolean
  createdAt: string
  completedAt: string | null
}

/** `TicketResult` (в составе заказа). Мандат прохода и QR не входят (ADR-014). */
export interface TicketResult {
  ticketId: string
  orderId: string
  occurrence: SalesOccurrenceLink
  positionId: string
  productId: string
  address: SalesSeatAddress
  price: SalesMoney
  status: TicketStatus
  issuedAt: string
}

/** `OrderResult`. `paymentPageUrl` заполняется только ответом на создание заказа/попытки. */
export interface OrderResult {
  orderId: string
  reservationId: string
  occurrenceId: string
  status: SalesOrderStatus
  total: SalesMoney
  /** Срок брони: до него заказ можно оплатить. */
  reservationExpiresAt: string
  createdAt: string
  paidAt: string | null
  attempts: PaymentAttemptResult[]
  tickets: TicketResult[]
  paymentPageUrl?: string | null
}

export type MyTicketResult = TicketResult

export type MyTicketSortBy = 'IssuedAt' | 'StartsAt'

// --- Ценовые шаблоны (Sales/PriceTemplates) -------------------------------------------------

export interface PriceTemplateCategoryInput {
  /** `^[A-Z0-9_-]{1,32}$`. */
  code: string
  name: string
  basePrice: SalesMoney
  perOrderLimit?: number | null
}

export interface PriceTemplateRuleInput {
  kind: PriceRuleKind
  /** Отсутствие — правило уровня «весь шаблон». */
  categoryCode?: string | null
  /** Скидка — базисные пункты 1..10000, наценка — 1..100000; фиксированные виды — минорные единицы. */
  value: number
  period: SalesPeriod
  priority: number
}

/** `PriceTemplateResult` (список): архивные шаблоны не отличаются от неархивных в самом поле. */
export interface PriceTemplateListResult {
  id: string
  organizerId: string
  name: string
  currentVersion: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface PriceTemplateCategoryResult {
  code: string
  name: string
  basePrice: SalesMoney
  perOrderLimit: number | null
}

export interface PriceTemplateRuleResult {
  ruleNo: number
  kind: PriceRuleKind
  categoryCode: string | null
  value: number
  period: SalesPeriod
  priority: number
}

/**
 * `PriceTemplateVersionResult`: полный состав одной версии — ответ чтения версии и обеих команд
 * создания (версия 1 и следующая версия).
 */
export interface PriceTemplateVersionResult {
  templateId: string
  name: string
  version: number
  currentVersion: number
  versionCreatedAt: string
  categories: PriceTemplateCategoryResult[]
  rules: PriceTemplateRuleResult[]
}

export interface PriceTemplateVersionSummary {
  version: number
  createdAt: string
  isCurrent: boolean
}

export interface CreatePriceTemplateBody {
  name: string
  categories: PriceTemplateCategoryInput[]
  rules?: PriceTemplateRuleInput[]
}

export interface CreatePriceTemplateVersionBody {
  expectedVersion: number
  categories: PriceTemplateCategoryInput[]
  rules?: PriceTemplateRuleInput[]
}

export type PriceTemplateSortBy = 'Name' | 'UpdatedAt'

export interface PriceTemplateParams extends PageParams {
  includeArchived?: boolean
  sortBy?: PriceTemplateSortBy
}

// --- Клиент -----------------------------------------------------------------

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

/**
 * HTTP-клиент первого среза продаж, в стиле `SeatingApi`: собственный `send`, разбор RFC 7807
 * (`Failure.ToProblem`) в `SeatingApiError`, журнал обмена для стенда, `Idempotency-Key` на
 * каждой команде. 409 приходит с `errorCode` вроде `InventoryConflict`, `SalesPriceChanged`,
 * `SalesZoneNotForSale`, `SalesPerOrderLimitExceeded`, `SalesNotOpen`, `SalesLayoutLocked`,
 * `ReservationNotActive`, `OrderNotPayable`, `PaymentAttemptNotPending`,
 * `PriceTemplateVersionConflict` — вызывающий код читает его на `error.errorCode`.
 */
export class SalesApi {
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

  // --- Ценовые шаблоны организатора --------------------------------------

  listPriceTemplates(
    params: PriceTemplateParams = {},
  ): Promise<PagedResult<PriceTemplateListResult>> {
    return this.send('GET', '/api/price-templates' + query({ ...params }))
  }

  getPriceTemplate(id: string, version?: number | null): Promise<PriceTemplateVersionResult> {
    return this.send('GET', '/api/price-templates/' + id + query({ version }))
  }

  listPriceTemplateVersions(
    id: string,
    params: Pick<PageParams, 'offset' | 'limit' | 'sortDirection'> &
      { sortBy?: 'Version' | 'CreatedAt' } = {},
  ): Promise<PagedResult<PriceTemplateVersionSummary>> {
    return this.send('GET', '/api/price-templates/' + id + '/versions' + query({ ...params }))
  }

  archivePriceTemplate(id: string, key: string): Promise<PriceTemplateListResult> {
    return this.send('POST', '/api/price-templates/' + id + '/archive', undefined, key)
  }

  /** Создаёт шаблон версии 1 (201 Created). */
  createPriceTemplate(
    body: CreatePriceTemplateBody,
    key: string,
  ): Promise<PriceTemplateVersionResult> {
    return this.send('POST', '/api/price-templates', body, key)
  }

  /** Полный набор категорий и правил новой версии; `expectedVersion` расходится — 409. */
  createPriceTemplateVersion(
    id: string,
    body: CreatePriceTemplateVersionBody,
    key: string,
  ): Promise<PriceTemplateVersionResult> {
    return this.send('POST', '/api/price-templates/' + id + '/versions', body, key)
  }

  // --- Компоновка и цены показа -------------------------------------------

  /** Прочитать текущую привязку и назначения — организаторский стенд продаж. */
  getOccurrenceSalesSetup(occurrenceId: string): Promise<OccurrenceSalesSetupResult> {
    return this.send('GET', '/api/occurrences/' + occurrenceId + '/layout')
  }

  /**
   * До первой брони перепривязка заменяет набор зон/единиц заново; после первой брони показа —
   * 409 `SalesLayoutLocked`.
   */
  bindLayout(
    occurrenceId: string,
    body: BindOccurrenceLayoutBody,
    key: string,
  ): Promise<OccurrenceSalesSetupResult> {
    return this.send('PUT', '/api/occurrences/' + occurrenceId + '/layout', body, key)
  }

  /** Зона `NotSupported` в присланном наборе — 409 `SalesZoneKindNotSupported`. */
  applyPricing(
    occurrenceId: string,
    body: ApplyOccurrencePricingBody,
    key: string,
  ): Promise<OccurrenceSalesSetupResult> {
    return this.send('POST', '/api/occurrences/' + occurrenceId + '/pricing-applications', body, key)
  }

  getOrganizerSales(occurrenceId: string): Promise<OccurrenceSalesResult> {
    return this.send('GET', '/api/occurrences/' + occurrenceId + '/sales')
  }

  /** То же, что у организатора, плюс `holderSubjectId` на каждой занятой единице. */
  getAdminSales(occurrenceId: string): Promise<AdminOccurrenceSalesResult> {
    return this.send('GET', '/api/admin/occurrences/' + occurrenceId + '/sales')
  }

  // --- Витрина покупателя (анонимно) --------------------------------------

  getPublicSeating(occurrenceId: string): Promise<OccurrenceSeatingResult> {
    return this.send('GET', '/api/public/occurrences/' + occurrenceId + '/seating')
  }

  /** Не кешируется на сервере (`Cache-Control: no-store`). */
  getAvailability(
    occurrenceId: string,
    params: { zoneId?: string } = {},
  ): Promise<OccurrenceAvailabilityResult> {
    return this.send(
      'GET',
      '/api/public/occurrences/' + occurrenceId + '/availability' + query({ ...params }),
    )
  }

  // --- Бронь ---------------------------------------------------------------

  createReservation(
    body: CreateReservationBody,
    key: string,
  ): Promise<ReservationResult> {
    return this.send('POST', '/api/me/reservations', body, key)
  }

  getReservation(id: string): Promise<ReservationResult> {
    return this.send('GET', '/api/me/reservations/' + id)
  }

  /** `Active → Released`; единицы этой брони освобождаются. */
  releaseReservation(id: string, key: string): Promise<ReservationResult> {
    return this.send('POST', '/api/me/reservations/' + id + '/release', undefined, key)
  }

  // --- Заказ и оплата --------------------------------------------------------

  /** Один заказ на бронь: повтор с тем же ключом возвращает тот же заказ. */
  createOrder(body: { reservationId: string }, key: string): Promise<OrderResult> {
    return this.send('POST', '/api/me/orders', body, key)
  }

  /** Новая попытка оплаты после отказа, пока бронь ещё активна. */
  retryPayment(orderId: string, key: string): Promise<OrderResult> {
    return this.send('POST', '/api/me/orders/' + orderId + '/payment-attempts', undefined, key)
  }

  getOrder(id: string): Promise<OrderResult> {
    return this.send('GET', '/api/me/orders/' + id)
  }

  /**
   * Только при `Payments:Mock:Enabled`: эмулирует обратный вызов провайдера и запускает общую
   * финализацию. Доступно только владельцу заказа.
   */
  submitMockOutcome(
    paymentAttemptId: string,
    body: { outcome: MockPaymentOutcome },
    key: string,
  ): Promise<OrderResult> {
    return this.send(
      'POST',
      '/api/me/payment-attempts/' + paymentAttemptId + '/mock-outcome',
      body,
      key,
    )
  }

  getMyTickets(
    params: Pick<PageParams, 'offset' | 'limit' | 'sortDirection'> & { sortBy?: MyTicketSortBy } = {},
  ): Promise<PagedResult<MyTicketResult>> {
    return this.send('GET', '/api/me/tickets' + query({ ...params }))
  }
}
