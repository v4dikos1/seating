import {
  createNativeBridge, mountSeatingWidget,
  type NativeBridge, type WidgetContext,
} from '@tickets/seating/embed';

/**
 * Точка входа `webview-host.html`: страница живёт внутри мобильного WebView (Flutter/React
 * Native), сама встраивает виджет в iframe через обычный SDK хоста (`mountSeatingWidget`,
 * артефакт 20 §6.1) и пробрасывает события/команды нативной стороне через `native-bridge.ts`.
 * Инструкция по подключению с обеих платформ — `apps/seating-lab/README.md`.
 *
 * Тестовый режим: контекст (включая токен покупателя) приходит от нативного приложения
 * сообщением после того, как оно получит `instanceId` из самого первого события виджета —
 * короткоживущей сессии встраивания и allowlist происхождения ещё нет (спецификация §0).
 */

const container = document.getElementById('widget-root');
if (!container) {
  throw new Error('#widget-root отсутствует в webview-host.html');
}

// Пустой контекст до первой команды от нативной стороны: сервер такой не примет,
// а виджет просто останется в ожидании — это безопаснее, чем выдумывать значения.
const bootContext: WidgetContext = { apiRoot: '', occurrenceId: '', testMode: true };

// Мост создаётся только после handle (ему нужен handle.instanceId), а handle должен уметь
// публиковать в мост из своего onEvent сразу: обычная ссылка-контейнер вместо `let` с забеганием
// вперёд — так что здесь ничего не переприсваивается, только поле объекта.
const bridgeRef: { current: NativeBridge | null } = { current: null };

const handle = mountSeatingWidget({
  container,
  src: './widget.html',
  context: bootContext,
  title: 'Схема зала',
  // Страница сама занимает весь экран WebView: подстраивать высоту iframe под контент
  // виджета не нужно, он и так растянут на 100% через webview-host.css.
  autoResize: false,
  onEvent: (message) => bridgeRef.current?.publish(message),
});

handle.iframe.style.width = '100%';
handle.iframe.style.height = '100%';

bridgeRef.current = createNativeBridge({
  instanceId: handle.instanceId,
  onHostMessage: (message) => {
    if (message.type === 'context') handle.updateContext(message.context);
    if (message.type === 'clearSelection') handle.clearSelection();
  },
});

window.addEventListener('pagehide', () => {
  bridgeRef.current?.destroy();
  handle.destroy();
});
