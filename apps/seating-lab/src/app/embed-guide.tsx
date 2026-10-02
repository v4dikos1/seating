import { useState } from 'react';
import { CopyId } from './journey-id';
import { Button, Note, Section } from './ui';

export function embedExamples(occurrenceId: string) {
  const id = occurrenceId || 'ВСТАВЬТЕ_ID_ПОКАЗА';
  return {
    javascript: `import { mountSeatingWidget } from '@tickets/seating/embed';

const context = {
  apiRoot: 'http://localhost:5057',
  occurrenceId: '${id}',
  testMode: true,
  token: buyerToken,
  locale: 'ru',
};
const handle = mountSeatingWidget({
  container: document.getElementById('seating'),
  src: 'http://localhost:4200/widget.html',
  context,
  autoResize: true,
  onEvent: (message) => console.log(message.type, message),
});
// При обновлении токена покупателя:
handle.updateContext({ ...context, token: refreshedBuyerToken });
// При уходе со страницы:
handle.destroy();`,
    react: `import { SeatingWidget } from '@tickets/seating/embed';

function Seats({ buyerToken }) {
  const context = {
    apiRoot: 'http://localhost:5057',
    occurrenceId: '${id}',
    testMode: true,
    token: buyerToken,
    locale: 'ru',
  };
  return <SeatingWidget
    src='http://localhost:4200/widget.html'
    context={context}
    autoResize
    onEvent={(message) => console.log(message.type, message)}
  />;
}`, 
    webview: `// Загрузите http://localhost:4200/webview-host.html в WebView.
// Первое событие ready содержит instanceId. Сохраните его.
const command = {
  protocolVersion: 2,
  instanceId,
  requestId: crypto.randomUUID(),
  type: 'context',
  context: {
    apiRoot: 'http://localhost:5057',
    occurrenceId: '${id}',
    testMode: true,
    token: buyerToken,
    locale: 'ru',
  },
};
const script = 'window.seatingBridge.receive(' +
  JSON.stringify(JSON.stringify(command)) + '); true;';
// React Native: webViewRef.current?.injectJavaScript(script)
// Flutter: controller.runJavaScript(script)
// Ответы: window.ReactNativeWebView.postMessage(json)
// или window.SeatingBridge.postMessage(json) для Flutter.`,
  };
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return <div className='embed-code'><div className='embed-code-head'><h2>{title}</h2><Button kind='quiet' onClick={() => {
    void navigator.clipboard.writeText(code).then(() => setCopied(true)).catch(() => setCopied(false));
  }}>{copied ? 'Скопировано' : 'Скопировать'}</Button></div><pre><code>{code}</code></pre></div>;
}

export function EmbedGuidePage({ occurrenceId }: { occurrenceId: string }) {
  const snippets = embedExamples(occurrenceId);
  const siteUrl = `http://localhost:4300/site-host.html${occurrenceId ? `?occurrenceId=${encodeURIComponent(occurrenceId)}` : ''}`;
  return <Section title='Встраивание виджета' description='Инструкция для фронтенд-разработчика сайта организатора.'>
    <div className='embed-guide'>
      <p>Виджет — изолированный iframe с обменом через postMessage. Подключите SDK <code>@tickets/seating/embed</code>, передайте контейнер, адрес <code>widget.html</code> и контекст показа.</p>
      <Note tone='warn'>Сейчас доступен только тестовый режим: токен покупателя передаёт хост. Короткоживущих сессий, allowlist происхождения и CSP ещё нет.</Note>
      {occurrenceId ? <CopyId label='Выбранный ID показа' value={occurrenceId} /> : <Note tone='info'>ID показа можно выбрать в режиме «Организатор» → «Путь до продаж».</Note>}
      <ol><li>Получите ID опубликованного показа и токен покупателя.</li><li>Смонтируйте виджет и включите автоподстройку высоты.</li><li>При обновлении токена вызовите <code>handle.updateContext</code>, при уходе со страницы — <code>handle.destroy()</code>.</li></ol>
      <CodeBlock title='Чистый JavaScript' code={snippets.javascript} />
      <CodeBlock title='React' code={snippets.react} />
      <CodeBlock title='Мобильный WebView' code={snippets.webview} />
      <p>WebView использует страницу <code>webview-host.html</code> и <code>window.seatingBridge.receive(...)</code>. События возвращаются в <code>ReactNativeWebView.postMessage</code> или Flutter <code>JavaScriptChannel</code>.</p>
      <h2>События виджета</h2>
      <ul>
        <li><code>selectionChanged</code> — <code>selection</code>: выбранные места.</li>
        <li><code>reservationCreated</code> — <code>reservationId</code>, <code>expiresAt</code>, <code>totalAmountMinor</code>, <code>currency</code>.</li>
        <li><code>expired</code> — <code>reservationId</code>.</li>
        <li><code>purchaseCompleted</code> — <code>orderId</code>, <code>ticketIds</code>.</li>
        <li><code>error</code> — <code>message</code>, необязательный <code>code</code>.</li>
        <li><code>resize</code> — <code>height</code>; SDK сам меняет высоту iframe.</li>
      </ul>
      <p>Для проверки запустите второй экземпляр стенда из <code>apps/seating-lab</code>: <code>npx vite --port 4300 --strictPort</code>. Тестовый сайт загрузит виджет с порта 4200.</p>
      <Button kind='primary' onClick={() => window.open(siteUrl, '_blank', 'noopener,noreferrer')}>Открыть тестовый сайт</Button>
    </div>
  </Section>;
}
