import {
  mountSeatingWidget,
  type SeatingWidgetHandle, type WidgetContext, type WidgetMessage,
} from '@tickets/seating/embed';
import { formatMoney } from '@tickets/seating';

/**
 * Точка входа `site-host.html`: сторонний сайт, встраивающий виджет продаж. Параметры
 * встраивания запоминаются в localStorage этого origin, чтобы после перезагрузки страницы
 * не вводить их заново; токен покупателя не запоминается — он короткоживущий и чужой.
 */

const storageKey = 'site-host.embed';
const defaults = {
  occurrenceId: '',
  apiRoot: 'http://localhost:5057',
  widgetUrl: 'http://localhost:4200/widget.html',
};

const form = document.getElementById('embed-form') as HTMLFormElement;
const container = document.getElementById('widget-root') as HTMLElement;
const log = document.getElementById('event-log') as HTMLOListElement;
const updateToken = document.getElementById('update-token') as HTMLButtonElement;

let handle: SeatingWidgetHandle | null = null;
let context: WidgetContext | null = null;

function readStored(): typeof defaults {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) ?? '{}') };
  } catch {
    return defaults;
  }
}

function field(name: string): HTMLInputElement {
  return form.elements.namedItem(name) as HTMLInputElement;
}

function describe(message: WidgetMessage): string {
  switch (message.type) {
    case 'reservationCreated':
      return `Бронь создана до ${new Date(message.expiresAt).toLocaleTimeString('ru-RU')}, `
        + formatMoney(message.totalAmountMinor, message.currency);
    case 'purchaseCompleted':
      return `Покупка завершена, билетов: ${message.ticketIds.length}`;
    case 'expired':
      return 'Срок брони истёк';
    case 'selectionChanged':
      return `Выбрано мест: ${message.selection.length}`;
    case 'error':
      return `Ошибка виджета: ${message.message}`;
    default:
      return message.type;
  }
}

function append(message: WidgetMessage) {
  // Изменение высоты приходит на каждый кадр вёрстки — в журнале оно только мешает.
  if (message.type === 'resize') return;
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString('ru-RU')} — ${describe(message)}`;
  log.prepend(item);
}

function contextFromForm(): WidgetContext {
  const token = field('token').value.trim();
  return {
    apiRoot: field('apiRoot').value.trim(),
    occurrenceId: field('occurrenceId').value.trim(),
    testMode: true,
    token: token || null,
    locale: 'ru',
  };
}

function mount() {
  const widgetUrl = field('widgetUrl').value.trim();
  context = contextFromForm();
  localStorage.setItem(storageKey, JSON.stringify({
    occurrenceId: context.occurrenceId, apiRoot: context.apiRoot, widgetUrl,
  }));

  handle?.destroy();
  container.replaceChildren();
  log.replaceChildren();
  handle = mountSeatingWidget({
    container,
    src: widgetUrl,
    context,
    title: 'Выбор мест',
    // Как на настоящем сайте: высоту iframe задаёт содержимое виджета, страница прокручивается сама.
    autoResize: true,
    onEvent: append,
  });
}

const stored = readStored();
field('occurrenceId').value = new URLSearchParams(window.location.search).get('occurrenceId') ?? stored.occurrenceId;
field('apiRoot').value = stored.apiRoot;
field('widgetUrl').value = stored.widgetUrl;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  mount();
});

updateToken.addEventListener('click', () => {
  if (!handle || !context) return;
  context = { ...context, token: field('token').value.trim() || null };
  handle.updateContext(context);
});
