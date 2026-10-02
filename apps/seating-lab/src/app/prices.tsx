import { useEffect, useMemo, useState } from 'react';
import { Coins, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  SalesApi, newIdempotencyKey,
  type PriceRuleKind, type PriceTemplateCategoryInput, type PriceTemplateListResult,
  type PriceTemplateRuleInput, type PriceTemplateVersionResult, type PriceTemplateVersionSummary,
} from '@tickets/seating';

import { useLab, useRequest } from './state';
import { Badge, Button, Empty, Modal, Note, Numeric, Problem, Section, Select, Spinner, Text } from './ui';

const ruleKinds: { value: PriceRuleKind; title: string }[] = [
  { value: 'PercentDiscount', title: 'Скидка, %' },
  { value: 'FixedDiscount', title: 'Скидка, AMD' },
  { value: 'PercentMarkup', title: 'Наценка, %' },
  { value: 'FixedMarkup', title: 'Наценка, AMD' },
];

// Сервер хранит деньги в минорных единицах (1 AMD = 100), а проценты — в базисных пунктах
// (1 % = 100). Организатор вводит привычные драмы и проценты; перевод выполняется здесь.
const minorPerUnit = 100;
const basisPointsPerPercent = 100;

function toMinor(amount: number): number {
  return Math.max(0, Math.round(amount * minorPerUnit));
}

function isPercent(kind: PriceRuleKind): boolean {
  return kind === 'PercentDiscount' || kind === 'PercentMarkup';
}

function ruleScale(kind: PriceRuleKind): number {
  return isPercent(kind) ? basisPointsPerPercent : minorPerUnit;
}

function emptyCategory(): PriceTemplateCategoryInput {
  return { code: '', name: '', basePrice: { amountMinor: 0, currency: 'AMD' }, perOrderLimit: null };
}

function emptyRule(): PriceTemplateRuleInput {
  return { kind: 'PercentDiscount', categoryCode: null, value: 0,
    period: { from: null, to: null }, priority: 0 };
}

/** Редактор набора: те же поля, что и `PriceTemplateVersionPayload.cs` на сервере. */
function VersionEditor({
  categories, rules, onChange,
}: {
  categories: PriceTemplateCategoryInput[];
  rules: PriceTemplateRuleInput[];
  onChange: (next: { categories: PriceTemplateCategoryInput[]; rules: PriceTemplateRuleInput[] }) => void;
}) {
  function updateCategory(index: number, patch: Partial<PriceTemplateCategoryInput>) {
    onChange({
      categories: categories.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      rules,
    });
  }
  function updateRule(index: number, patch: Partial<PriceTemplateRuleInput>) {
    onChange({ categories, rules: rules.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  }

  return (
    <div>
      <div className='inspector-panel-head'>
        <h4>Категории</h4>
        <Button kind='secondary' icon={<Plus size={13} />}
          onClick={() => onChange({ categories: [...categories, emptyCategory()], rules })}>
          Добавить категорию
        </Button>
      </div>
      {categories.map((category, index) => (
        <div key={index} className='pair' style={{ alignItems: 'flex-start', marginBottom: 10 }}>
          <Text label='Код (A-Z0-9_-)' value={category.code} maxLength={32}
            onChange={(value) => updateCategory(index, { code: value.toUpperCase() })} />
          <Text label='Название' value={category.name} maxLength={200}
            onChange={(value) => updateCategory(index, { name: value })} />
          <Numeric label='Базовая цена, AMD' value={category.basePrice.amountMinor / minorPerUnit} min={0} step={0.01}
            onChange={(value) => updateCategory(index, { basePrice: { ...category.basePrice, amountMinor: toMinor(value) } })} />
          <Numeric label='Лимит в брони' value={category.perOrderLimit ?? null} min={1}
            placeholder='без предела'
            onChange={(value) => updateCategory(index, { perOrderLimit: value > 0 ? Math.round(value) : null })} />
          <Button kind='danger' icon={<Trash2 size={13} />}
            onClick={() => onChange({ categories: categories.filter((_, i) => i !== index), rules })} />
        </div>
      ))}
      {categories.length === 0 ? <Note tone='info'>Нужна хотя бы одна категория.</Note> : null}

      <div className='inspector-panel-head' style={{ marginTop: 16 }}>
        <h4>Правила расчёта</h4>
        <Button kind='secondary' icon={<Plus size={13} />}
          onClick={() => onChange({ categories, rules: [...rules, emptyRule()] })}>
          Добавить правило
        </Button>
      </div>
      {rules.map((rule, index) => (
        <div key={index} className='pair' style={{ alignItems: 'flex-start', marginBottom: 10 }}>
          <Select label='Вид' value={rule.kind} options={ruleKinds}
            onChange={(value) => updateRule(index, { kind: value })} />
          <Select label='Категория' value={rule.categoryCode ?? ''}
            placeholder='Весь шаблон'
            options={categories.filter((c) => c.code).map((c) => ({ value: c.code, title: c.code }))}
            onChange={(value) => updateRule(index, { categoryCode: value || null })} />
          <Numeric label={isPercent(rule.kind) ? 'Значение, %' : 'Значение, AMD'}
            value={rule.value / ruleScale(rule.kind)} min={0} step={0.01}
            onChange={(value) => updateRule(index, { value: Math.max(0, Math.round(value * ruleScale(rule.kind))) })} />
          <Numeric label='Приоритет' value={rule.priority} min={0}
            onChange={(value) => updateRule(index, { priority: Math.max(0, Math.round(value)) })} />
          <Button kind='danger' icon={<Trash2 size={13} />}
            onClick={() => onChange({ categories, rules: rules.filter((_, i) => i !== index) })} />
        </div>
      ))}
    </div>
  );
}

export function PricesPage() {
  const { connection, signedIn } = useLab();
  const salesApi = useMemo(() => new SalesApi({ baseUrl: connection.baseUrl, token: connection.token }), [connection]);
  const [templates, setTemplates] = useState<PriceTemplateListResult[] | null>(null);
  const { busy, error, run } = useRequest();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<{ categories: PriceTemplateCategoryInput[]; rules: PriceTemplateRuleInput[] }>(
    { categories: [emptyCategory()], rules: [] },
  );

  const [versionOf, setVersionOf] = useState<PriceTemplateListResult | null>(null);
  const [version, setVersion] = useState<PriceTemplateVersionResult | null>(null);
  const [historyOf, setHistoryOf] = useState<PriceTemplateListResult | null>(null);
  const [history, setHistory] = useState<PriceTemplateVersionSummary[]>([]);

  const load = async () => {
    const page = await run(() => salesApi.listPriceTemplates({ limit: 200 }));
    if (page) setTemplates(page.items);
  };

  useEffect(() => {
    if (signedIn) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  async function submitCreate() {
    const result = await run(() => salesApi.createPriceTemplate(
      { name: name.trim(), categories: draft.categories, rules: draft.rules },
      newIdempotencyKey(),
    ));
    if (result) {
      setCreating(false);
      setName('');
      setDraft({ categories: [emptyCategory()], rules: [] });
      await load();
    }
  }

  async function openVersion(template: PriceTemplateListResult) {
    setVersionOf(template);
    const result = await run(() => salesApi.getPriceTemplate(template.id));
    if (result) {
      setVersion(result);
      setDraft({ categories: result.categories, rules: result.rules });
    }
  }

  async function submitVersion() {
    if (!versionOf || !version) return;
    const result = await run(() => salesApi.createPriceTemplateVersion(
      versionOf.id,
      { expectedVersion: version.currentVersion, categories: draft.categories, rules: draft.rules },
      newIdempotencyKey(),
    ));
    if (result) {
      setVersionOf(null);
      setVersion(null);
      await load();
    }
  }

  async function archive(template: PriceTemplateListResult) {
    const result = await run(() => salesApi.archivePriceTemplate(template.id, newIdempotencyKey()));
    if (result) await load();
  }

  async function openHistory(template: PriceTemplateListResult) {
    const page = await run(() => salesApi.listPriceTemplateVersions(template.id,
      { limit: 200, sortBy: 'Version', sortDirection: 'Desc' }));
    if (page) {
      setHistoryOf(template);
      setHistory(page.items);
    }
  }

  return (
    <Section
      title='Ценовые шаблоны'
      description='Шаблон копируется в показ при применении: правка шаблона не меняет уже применённые показы.'
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button kind='secondary' icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />} onClick={load}>
            Обновить
          </Button>
          <Button kind='primary' icon={<Plus size={15} />}
            onClick={() => { setDraft({ categories: [emptyCategory()], rules: [] }); setName(''); setCreating(true); }}>
            Создать шаблон
          </Button>
        </div>
      }
    >
      <Problem error={error} />
      {templates === null && busy ? <Spinner label='Загружаем шаблоны…' /> : null}
      {templates !== null && templates.length === 0 ? (
        <Empty title='Шаблонов пока нет' icon={<Coins size={40} />}>
          Создайте первый ценовой шаблон, чтобы назначить цены показу.
        </Empty>
      ) : null}

      {templates && templates.length > 0 ? (
        <div className='table-wrap'>
          <table className='table'>
            <thead>
              <tr>
                <th>Название</th>
                <th>Версия</th>
                <th>Обновлён</th>
                <th style={{ textAlign: 'right' }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td>{template.name}</td>
                  <td><Badge tone='brand'>v{template.currentVersion}</Badge></td>
                  <td>{new Date(template.updatedAt).toLocaleString('ru-RU')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button kind='secondary' onClick={() => openVersion(template)}>Открыть / новая версия</Button>
                    <Button kind='secondary' onClick={() => openHistory(template)}>Версии</Button>
                    {!template.archivedAt ? (
                      <Button kind='danger' disabled={busy} onClick={() => archive(template)}>Архивировать</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {creating ? (
        <Modal
          wide
          title='Новый ценовой шаблон'
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button onClick={() => setCreating(false)}>Отмена</Button>
              <Button kind='primary' disabled={busy || !name.trim() || !draft.categories.length} onClick={submitCreate}>
                Создать
              </Button>
            </>
          }
        >
          <Text label='Название шаблона' value={name} maxLength={200} onChange={setName} />
          <VersionEditor categories={draft.categories} rules={draft.rules} onChange={setDraft} />
        </Modal>
      ) : null}

      {versionOf ? (
        <Modal
          wide
          title={'Шаблон «' + versionOf.name + '»'}
          subtitle={version ? `Текущая версия v${version.currentVersion}` : undefined}
          onClose={() => { setVersionOf(null); setVersion(null); }}
          footer={
            <>
              <Button onClick={() => { setVersionOf(null); setVersion(null); }}>Отмена</Button>
              <Button kind='primary' disabled={busy || !version || !draft.categories.length} onClick={submitVersion}>
                Сохранить как новую версию
              </Button>
            </>
          }
        >
          {!version ? <Spinner label='Загружаем версию…' /> : (
            <>
              <Note tone='info'>
                Правка не меняет применённые показы: сохранение заведёт версию v{version.currentVersion + 1}.
              </Note>
              <VersionEditor categories={draft.categories} rules={draft.rules} onChange={setDraft} />
            </>
          )}
        </Modal>
      ) : null}

      {historyOf ? (
        <Modal title={`Версии «${historyOf.name}»`} onClose={() => setHistoryOf(null)}
          footer={<Button onClick={() => setHistoryOf(null)}>Закрыть</Button>}>
          <ul>{history.map((item) => (
            <li key={item.version}>v{item.version} · {new Date(item.createdAt).toLocaleString('ru-RU')}
              {item.isCurrent ? ' · текущая' : ''}</li>
          ))}</ul>
        </Modal>
      ) : null}
    </Section>
  );
}
