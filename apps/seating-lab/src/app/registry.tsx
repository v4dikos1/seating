import { useState } from 'react'

import {
  type OfficialHallRegistryPreviewResult,
  type OfficialHallRegistryStageResult,
  type OfficialHallSchemeSourceResult,
  type OfficialHallSchemeStageResult,
  newIdempotencyKey,
  pdfContentType,
  xlsxContentType,
} from '@tickets/seating'
import { FileSpreadsheet, FileText, Upload } from 'lucide-react'

import { useLab, useRequest } from './state'
import { Badge, Button, Empty, Note, Problem, Section, Spinner } from './ui'

/** Размер файла человеческим языком — байты приходят из `File.size` браузера. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1_024) return `${bytes} Б`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} КиБ`
  return `${(bytes / (1_024 * 1_024)).toFixed(2)} МиБ`
}

/**
 * Экран читает официальный реестр и показывает строки, диагностику и подсказки каталога.
 * Кандидаты не подтверждаются автоматически, и этот экран не переносит данные в справочник.
 */
export function RegistryPage() {
  const { api } = useLab()
  const [preview, setPreview] =
    useState<OfficialHallRegistryPreviewResult | null>(null)
  const [staged, setStaged] = useState<OfficialHallRegistryStageResult | null>(
    null,
  )
  const [schemeRowIndex, setSchemeRowIndex] = useState('')
  const [registryFileId, setRegistryFileId] = useState('')
  const [pendingRegistry, setPendingRegistry] = useState<{
    sourceFileId: string
    fileName: string
  } | null>(null)
  const [schemeFileId, setSchemeFileId] = useState('')
  const [pendingScheme, setPendingScheme] = useState<{
    sourceFileId: string
    fileName: string
    sizeBytes: number
  } | null>(null)
  /**
   * Проверка фактических байтов загруженного PDF (SHA-256) до его фиксации за строкой
   * реестра — по явному запросу, не автоматически: не создаёт и не сохраняет ничего,
   * только пересчитывает hash на сервере (`GetOfficialHallSchemeSource`).
   */
  const [schemeSourcePreview, setSchemeSourcePreview] =
    useState<OfficialHallSchemeSourceResult | null>(null)
  const [schemeStageAttempt, setSchemeStageAttempt] = useState<{
    sourceFileId: string
    registryImportId: string
    registryRowIndex: number
    idempotencyKey: string
  } | null>(null)
  const [stagedSchemes, setStagedSchemes] = useState<
    Array<{
      fileName: string
      result: OfficialHallSchemeStageResult
    }>
  >([])
  const [operation, setOperation] = useState<
    'upload' | 'preview' | 'stage' | 'scheme' | 'restore' | null
  >(null)
  const { busy, error, setError, run } = useRequest()
  const recognizedVersion =
    preview?.version === 'v1' || preview?.version === 'v2'
  const canStage = Boolean(
    preview &&
    recognizedVersion &&
    preview.diagnostics.length === 0 &&
    preview.rows.length > 0,
  )

  async function upload(file: File) {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError(
        new Error('Выберите файл официального реестра с расширением .xlsx.'),
      )
      return
    }
    setPreview(null)
    setPendingRegistry(null)
    setRegistryFileId('')
    setStaged(null)
    setStagedSchemes([])
    setSchemeRowIndex('')
    setSchemeFileId('')
    setSchemeStageAttempt(null)
    setOperation('upload')
    const sourceFileId = await run(() =>
      api.uploadFile(
        file,
        newIdempotencyKey(),
        xlsxContentType,
      ),
    )
    if (sourceFileId) {
      setRegistryFileId(sourceFileId)
      setPendingRegistry({ sourceFileId, fileName: file.name })
      await previewRegistry(sourceFileId)
    }
    setOperation(null)
  }

  async function previewRegistry(sourceFileId: string) {
    setOperation('preview')
    const result = await run(() => api.previewHallRegistry(sourceFileId))
    if (result) {
      setPreview(result)
      setRegistryFileId(result.fileId)
      setPendingRegistry(null)
    }
    setOperation(null)
  }

  async function stage() {
    if (!preview || !canStage || staged) return
    setOperation('stage')
    const result = await run(() =>
      api.stageHallRegistry(preview.fileId, newIdempotencyKey()),
    )
    if (result) {
      setStaged(result)
      setRegistryFileId(result.sourceFileId)
    }
    setOperation(null)
  }

  async function stagePendingScheme(
    pending: { sourceFileId: string; fileName: string },
    registryRowIndex: number,
  ) {
    if (!staged) return
    const body = {
      sourceFileId: pending.sourceFileId,
      registryImportId: staged.id,
      registryRowIndex,
    }
    const sameRequest =
      schemeStageAttempt?.sourceFileId === body.sourceFileId &&
      schemeStageAttempt.registryImportId === body.registryImportId &&
      schemeStageAttempt.registryRowIndex === body.registryRowIndex
    const idempotencyKey = sameRequest
      ? schemeStageAttempt.idempotencyKey
      : newIdempotencyKey()
    setSchemeStageAttempt({ ...body, idempotencyKey })
    setOperation('scheme')
    const result = await run(() =>
      api.stageOfficialHallScheme(body, idempotencyKey),
    )
    if (result) {
      setStagedSchemes((current) => [
        ...current.filter(({ result: existing }) => existing.id !== result.id),
        { fileName: pending.fileName, result },
      ])
      setPendingScheme(null)
      setSchemeSourcePreview(null)
      setSchemeStageAttempt(null)
      setSchemeRowIndex('')
      setSchemeFileId('')
    }
    setOperation(null)
  }

  async function uploadScheme(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError(new Error('Выберите PDF-файл схемы зала.'))
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      setError(new Error('Размер PDF схемы не должен превышать 12 МиБ.'))
      return
    }
    if (!staged || !schemeRowIndex) {
      setError(
        new Error('Сначала сохраните XLSX на выверку и выберите строку зала.'),
      )
      return
    }
    const registryRowIndex = Number(schemeRowIndex)
    if (!staged.report.rows[registryRowIndex]) {
      setError(
        new Error('Выбранная строка отсутствует в сохранённом отчёте XLSX.'),
      )
      return
    }
    setOperation('scheme')
    setSchemeSourcePreview(null)
    const sourceFileId = await run(() =>
      api.uploadFile(file, newIdempotencyKey(), pdfContentType),
    )
    if (sourceFileId) {
      const pending = { sourceFileId, fileName: file.name, sizeBytes: file.size }
      setPendingScheme(pending)
      await stagePendingScheme(pending, registryRowIndex)
    }
    setOperation(null)
  }

  /**
   * Проверка того, что фактически лежит на сервере под этим PDF, до (пере)попытки
   * связать его со строкой реестра: SHA-256 пересчитывается сервером заново, поэтому
   * это не то же самое, что доверять байтам, которые видел браузер при выборе файла.
   */
  async function previewSchemeSource() {
    if (!pendingScheme) return
    const result = await run(() =>
      api.previewOfficialHallSchemeSource(pendingScheme.sourceFileId),
    )
    if (result) setSchemeSourcePreview(result)
  }

  async function retrySchemeStage() {
    if (!pendingScheme || !staged || !schemeRowIndex) return
    const registryRowIndex = Number(schemeRowIndex)
    if (!staged.report.rows[registryRowIndex]) {
      setError(
        new Error('Выбранная строка отсутствует в сохранённом отчёте XLSX.'),
      )
      return
    }
    await stagePendingScheme(pendingScheme, registryRowIndex)
  }

  async function restoreRegistry() {
    const fileId = registryFileId.trim()
    if (!fileId) return
    setOperation('restore')
    const result = await run(() => api.getStagedHallRegistry(fileId))
    if (result) {
      const sameImport = staged?.id === result.id
      setPendingRegistry(null)
      setStaged(result)
      setRegistryFileId(result.sourceFileId)
      setSchemeRowIndex('')
      setSchemeFileId('')
      if (!sameImport) setSchemeStageAttempt(null)
      setPreview({
        fileId: result.sourceFileId,
        fileName: result.sourceFileId,
        sha256: result.sha256,
        version: result.report.version,
        catalogMatchingAvailable: false,
        diagnostics: result.report.diagnostics,
        rows: result.report.rows.map((row) => ({
          ...row,
          match: {
            venueCandidates: [],
            venueSpaceCandidates: [],
            requiresManualConfirmation: true,
            diagnostics: [],
          },
        })),
      })
      if (!sameImport) setStagedSchemes([])
    }
    setOperation(null)
  }

  async function restoreScheme() {
    const fileId = schemeFileId.trim()
    if (!fileId || !staged) return
    setOperation('restore')
    const result = await run(() => api.getStagedHallScheme(fileId))
    if (result) {
      if (result.registryImportId !== staged.id) {
        setError(
          new Error(
            `Эта PDF-схема связана с XLSX импортом ${result.registryImportId}, текущий импорт — ${staged.id}. Восстановите соответствующий XLSX и повторите чтение PDF.`,
          ),
        )
      } else if (
        !stagedSchemes.some(({ result: current }) => current.id === result.id)
      ) {
        setStagedSchemes((current) => [
          ...current,
          { fileName: fileId, result },
        ])
        if (schemeRowIndex === String(result.registryRowIndex)) {
          setSchemeRowIndex('')
        }
      }
      if (result.registryImportId === staged.id) {
        setSchemeFileId('')
        if (pendingScheme?.sourceFileId === result.sourceFileId) {
          setPendingScheme(null)
          setSchemeStageAttempt(null)
          setSchemeRowIndex('')
        }
      }
    }
    setOperation(null)
  }

  return (
    <Section
      title='Официальный реестр залов'
      description='Проверка файла XLSX до того, как данные попадут в справочник площадок.'
      action={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className='floor-upload btn btn-primary'>
            <Upload size={16} /> Загрузить XLSX
            <input
              type='file'
              accept='.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void upload(file)
                event.currentTarget.value = ''
              }}
            />
          </label>
          <Button
            kind='primary'
            disabled={busy || !canStage || Boolean(staged)}
            title={staged ? 'Этот файл уже сохранён для выверки' : undefined}
            onClick={() => void stage()}
          >
            {staged ? 'Сохранено на выверку' : 'Сохранить на выверку'}
          </Button>
          {staged && !pendingScheme ? (
            <label
              className='floor-upload btn btn-secondary'
              title='PDF будет связан с выбранной строкой XLSX'
            >
              <FileText size={16} /> Загрузить PDF
              <input
                type='file'
                accept='.pdf,application/pdf'
                disabled={busy || !schemeRowIndex}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file) void uploadScheme(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          ) : null}
        </div>
      }
    >
      <Note tone='info'>
        Экран показывает предпросмотр и подсказки каталога. Они не подтверждают
        совпадения и не создают площадки, помещения или залы. Нужно
        платформенное полномочие
        <span className='mono'> SeatingManage</span>.
      </Note>

      {preview && !preview.catalogMatchingAvailable ? (
        <Note tone='warn'>
          Сопоставление с каталогом недоступно: для списка кандидатов нужно
          платформенное полномочие <span className='mono'>VenueRead</span>.
          Остальные данные предпросмотра доступны.
        </Note>
      ) : null}

      <Problem error={error} />
      {pendingRegistry ? (
        <Note tone='warn'>
          XLSX загружен: {pendingRegistry.fileName} · ID{' '}
          <span className='mono'>{pendingRegistry.sourceFileId}</span>.{' '}
          {busy
            ? 'Получаем предпросмотр.'
            : 'Предпросмотр не получен. Его можно повторить без повторной загрузки файла.'}
          {!busy ? (
            <div style={{ marginTop: 8 }}>
              <Button
                kind='primary'
                onClick={() =>
                  void previewRegistry(pendingRegistry.sourceFileId)
                }
              >
                Повторить предпросмотр
              </Button>
            </div>
          ) : null}
        </Note>
      ) : null}
      {busy ? (
        <Spinner
          label={
            operation === 'stage'
              ? 'Сохраняем на выверку…'
              : operation === 'preview'
                ? 'Получаем предпросмотр…'
                : operation === 'scheme'
                  ? 'Сохраняем PDF для выверки…'
                  : operation === 'restore'
                    ? 'Восстанавливаем сохранённые данные…'
                    : 'Разбираем реестр…'
          }
        />
      ) : null}

      <div className='card' style={{ marginBottom: 16 }}>
        <strong>Продолжить выверку по сохранённым файлам</strong>
        <p style={{ color: 'var(--ink-muted)', margin: '6px 0 12px' }}>
          После обновления страницы введите ID XLSX-файла, затем ID PDF для
          восстановления связи и статуса.
        </p>
        <div className='toolbar' style={{ alignItems: 'end' }}>
          <div className='field' style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor='registry-file-id'>ID XLSX-файла</label>
            <input
              id='registry-file-id'
              value={registryFileId}
              onChange={(event) => setRegistryFileId(event.currentTarget.value)}
              disabled={busy}
            />
          </div>
          <Button
            disabled={busy || !registryFileId.trim()}
            onClick={() => void restoreRegistry()}
          >
            Восстановить XLSX
          </Button>
          {staged ? (
            <>
              <div className='field' style={{ flex: 1, minWidth: 240 }}>
                <label htmlFor='scheme-file-id'>ID PDF-файла</label>
                <input
                  id='scheme-file-id'
                  value={schemeFileId}
                  onChange={(event) =>
                    setSchemeFileId(event.currentTarget.value)
                  }
                  disabled={busy}
                />
              </div>
              <Button
                disabled={busy || !schemeFileId.trim()}
                onClick={() => void restoreScheme()}
              >
                Восстановить PDF
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {!preview && !busy ? (
        <Empty title='Файл не выбран' icon={<FileSpreadsheet size={40} />}>
          Загрузите XLSX официального реестра, чтобы увидеть распознанные строки
          и замечания к структуре файла.
        </Empty>
      ) : null}

      {preview ? (
        <>
          {!canStage ? (
            <Note tone='warn'>
              {!recognizedVersion
                ? 'Сохранение для выверки доступно только для распознанных версий реестра v1 и v2.'
                : preview.diagnostics.length
                  ? 'Исправьте ошибки разбора реестра перед сохранением на выверку.'
                  : 'Для сохранения на выверку нужна хотя бы одна строка зала.'}
            </Note>
          ) : null}

          {staged ? (
            <Note tone='ok'>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <strong>Сохранено для ручной выверки</strong>
                <Badge tone='warning'>{staged.state}</Badge>
              </div>
              <div>
                Импорт: <span className='mono'>{staged.id}</span>
              </div>
              <div>
                ID исходного XLSX:{' '}
                <span className='mono'>{staged.sourceFileId}</span>
              </div>
              <div>
                SHA-256:{' '}
                <span className='mono' style={{ overflowWrap: 'anywhere' }}>
                  {staged.sha256}
                </span>
              </div>
              <div>
                Сохранено:{' '}
                <time dateTime={staged.stagedAt}>{staged.stagedAt}</time>
              </div>
            </Note>
          ) : null}

          {staged ? (
            <div className='card' style={{ marginBottom: 16 }}>
              <strong>Связать PDF схемы со строкой реестра</strong>
              <p style={{ color: 'var(--ink-muted)', margin: '6px 0 12px' }}>
                Выберите строку вручную. Схема будет сохранена для выверки с её
                hash и происхождением; места, зоны и данные каталога не
                создаются.
              </p>
              <div className='field' style={{ maxWidth: 680 }}>
                <label htmlFor='scheme-row-index'>
                  Строка сохранённого XLSX
                </label>
                <select
                  id='scheme-row-index'
                  value={schemeRowIndex}
                  disabled={busy}
                  onChange={(event) =>
                    setSchemeRowIndex(event.currentTarget.value)
                  }
                >
                  <option value=''>Выберите зал…</option>
                  {staged.report.rows.map((row, index) => {
                    const alreadyLinked = stagedSchemes.some(
                      ({ result }) =>
                        result.registryImportId === staged.id &&
                        result.registryRowIndex === index,
                    )
                    return (
                      <option
                        value={String(index)}
                        key={`${index}-${row.hallNameEn}`}
                        disabled={alreadyLinked}
                      >
                        {index + 1}.{' '}
                        {row.venueNameRu || row.venueNameEn || row.venueNameHy}{' '}
                        — {row.hallNameRu || row.hallNameEn || row.hallNameHy}
                        {alreadyLinked ? ' (PDF уже сохранён)' : ''}
                      </option>
                    )
                  })}
                </select>
              </div>
              {pendingScheme ? (
                <Note tone='warn'>
                  PDF уже загружен: {pendingScheme.fileName} · ID{' '}
                  <span className='mono'>{pendingScheme.sourceFileId}</span> ·{' '}
                  {formatBytes(pendingScheme.sizeBytes)}.
                  Выберите строку и повторите сохранение; файл повторно не
                  загружается.
                  {schemeSourcePreview?.sourceFileId ===
                  pendingScheme.sourceFileId ? (
                    <div style={{ marginTop: 6 }}>
                      Фактический SHA-256 на сервере:{' '}
                      <span
                        className='mono'
                        style={{ overflowWrap: 'anywhere' }}
                      >
                        {schemeSourcePreview.sha256}
                      </span>
                    </div>
                  ) : null}
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <Button
                      kind='secondary'
                      disabled={busy}
                      onClick={() => void previewSchemeSource()}
                    >
                      Проверить PDF на сервере
                    </Button>
                    <Button
                      kind='primary'
                      disabled={busy || !schemeRowIndex}
                      onClick={() => void retrySchemeStage()}
                    >
                      {schemeStageAttempt?.sourceFileId ===
                        pendingScheme.sourceFileId &&
                      schemeStageAttempt.registryImportId === staged.id &&
                      schemeStageAttempt.registryRowIndex ===
                        Number(schemeRowIndex)
                        ? 'Повторить сохранение'
                        : 'Связать PDF с выбранной строкой'}
                    </Button>
                  </div>
                </Note>
              ) : null}
              <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>
                XLSX import <span className='mono'>{staged.id}</span> · SHA-256{' '}
                <span className='mono'>{staged.sha256}</span>
              </div>
              {stagedSchemes.length ? (
                <div className='table-wrap' style={{ marginTop: 14 }}>
                  <table className='table small'>
                    <thead>
                      <tr>
                        <th>PDF</th>
                        <th>Связанная строка</th>
                        <th>Статус</th>
                        <th>SHA-256 / происхождение</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stagedSchemes.map(({ fileName, result }) => (
                        <tr key={result.id}>
                          <td>
                            {fileName}
                            <div>
                              PDF import{' '}
                              <span className='mono'>{result.id}</span>
                            </div>
                            <div
                              className='mono'
                              style={{ color: 'var(--ink-muted)' }}
                            >
                              {result.sourceFileId}
                            </div>
                          </td>
                          <td>
                            {result.hall.venueNameRu ||
                              result.hall.venueNameEn ||
                              result.hall.venueNameHy}{' '}
                            —{' '}
                            {result.hall.hallNameRu ||
                              result.hall.hallNameEn ||
                              result.hall.hallNameHy}
                            <div>Строка {result.registryRowIndex + 1}</div>
                          </td>
                          <td>
                            <Badge tone='warning'>{result.state}</Badge>
                          </td>
                          <td>
                            <div
                              className='mono'
                              style={{ overflowWrap: 'anywhere' }}
                            >
                              {result.sha256}
                            </div>
                            <div>
                              {result.adapter} {result.adapterVersion} ·{' '}
                              {result.stagedAt}
                            </div>
                            <div className='mono'>
                              XLSX {result.registryImportId} · rowIndex{' '}
                              {result.registryRowIndex}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className='toolbar'>
            <div className='card-badges'>
              <Badge tone='brand'>{preview.fileName}</Badge>
              <Badge tone={preview.version ? 'success' : 'warning'}>
                {preview.version
                  ? `Версия реестра ${preview.version}`
                  : 'Версия не распознана'}
              </Badge>
              <Badge tone='neutral'>Строк: {preview.rows.length}</Badge>
              <Badge tone={preview.diagnostics.length ? 'danger' : 'success'}>
                Замечаний: {preview.diagnostics.length}
              </Badge>
            </div>
            <span
              className='mono'
              title='SHA-256 исходного XLSX'
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                color: 'var(--ink-muted)',
                overflowWrap: 'anywhere',
              }}
            >
              SHA-256: {preview.sha256}
            </span>
          </div>

          {preview.diagnostics.length ? (
            <div className='table-wrap' style={{ marginBottom: 18 }}>
              <table className='table small'>
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Строка</th>
                    <th style={{ width: 200 }}>Код</th>
                    <th>Что не так</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.diagnostics.map((item, index) => (
                    <tr
                      key={`${item.code}-${item.row ?? index}`}
                      className='failed'
                    >
                      <td>{item.row ?? '—'}</td>
                      <td className='mono'>{item.code}</td>
                      <td>{item.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {preview.rows.length ? (
            <div className='table-wrap'>
              <table className='table small'>
                <thead>
                  <tr>
                    <th>Площадка</th>
                    <th>Зал</th>
                    <th style={{ textAlign: 'right' }}>Мест по реестру</th>
                    <th>Адрес</th>
                    <th>Контакты</th>
                    <th>Кандидаты каталога</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={`${row.venueNameEn}-${row.hallNameEn}-${index}`}>
                      <td>
                        <strong>
                          {row.venueNameRu ||
                            row.venueNameEn ||
                            row.venueNameHy}
                        </strong>
                        {row.officialWebsite ? (
                          <div
                            className='mono'
                            style={{ color: 'var(--ink-muted)' }}
                          >
                            {row.officialWebsite}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {row.hallNameRu || row.hallNameEn || row.hallNameHy}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {row.officialSeatCapacity ?? '—'}
                      </td>
                      <td>{row.addressRu || row.addressEn || row.addressHy}</td>
                      <td>
                        {row.phone ? <div>{row.phone}</div> : null}
                        {row.email ? (
                          <div className='mono'>{row.email}</div>
                        ) : null}
                        {!row.phone && !row.email ? '—' : null}
                      </td>
                      <td>
                        <Badge
                          tone={
                            row.match.requiresManualConfirmation
                              ? 'warning'
                              : 'success'
                          }
                        >
                          {row.match.requiresManualConfirmation
                            ? 'Нужно подтвердить вручную'
                            : 'Совпадение подтверждено'}
                        </Badge>
                        {row.match.venueCandidates.length ? (
                          <div style={{ marginTop: 6 }}>
                            <strong>Площадки-кандидаты</strong>
                            {row.match.venueCandidates.map((id) => (
                              <div className='mono' key={`venue-${id}`}>
                                {id}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div
                            style={{ marginTop: 6, color: 'var(--ink-muted)' }}
                          >
                            {preview.catalogMatchingAvailable
                              ? 'Кандидаты площадки не найдены'
                              : 'Площадка не проверена'}
                          </div>
                        )}
                        {row.match.venueSpaceCandidates.length ? (
                          <div style={{ marginTop: 6 }}>
                            <strong>Помещения-кандидаты</strong>
                            {row.match.venueSpaceCandidates.map((id) => (
                              <div className='mono' key={`space-${id}`}>
                                {id}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {row.match.diagnostics.map((item, diagnosticIndex) => (
                          <div
                            key={`${item.code}-${diagnosticIndex}`}
                            style={{ marginTop: 6 }}
                          >
                            <div
                              className='mono'
                              style={{ color: 'var(--ink-muted)' }}
                            >
                              {item.code}
                            </div>
                            <div>{item.message}</div>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title='В файле нет строк залов'>
              Реестр прочитан, но ни одной строки зала в нём не распознано.
            </Empty>
          )}

          <Note tone='warn'>
            Число мест из реестра — справочная величина источника, а не
            продаваемая квота. Схема зала по-прежнему рисуется в конфигураторе.
          </Note>
        </>
      ) : null}
    </Section>
  )
}
