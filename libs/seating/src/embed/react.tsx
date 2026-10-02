import { useEffect, useRef } from 'react';
import { mountSeatingWidget, type SeatingWidgetHandle } from './host';
import type { WidgetContext, WidgetMessage, WidgetSeat } from './protocol';

export interface SeatingWidgetProps {
  /** Адрес страницы виджета: тот же origin или отдельный домен встраивания. */
  src: string;
  context: WidgetContext;
  className?: string;
  title?: string;
  autoResize?: boolean;
  onReady?: () => void;
  onSelectionChange?: (selection: WidgetSeat[]) => void;
  onError?: (message: string, code?: string) => void;
  onEvent?: (message: WidgetMessage) => void;
}

/**
 * Обёртка для собственных React-приложений: типизированные входы и события вместо
 * ручной работы с postMessage. Для внешних сайтов остаётся `mountSeatingWidget`.
 */
export function SeatingWidget(props: SeatingWidgetProps) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<SeatingWidgetHandle | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  // Пересоздание iframe только при смене адреса: смена контекста идёт сообщением.
  useEffect(() => {
    if (!host.current) return;
    const mounted = mountSeatingWidget({
      container: host.current,
      src: props.src,
      context: callbacks.current.context,
      title: props.title,
      autoResize: props.autoResize,
      onReady: () => callbacks.current.onReady?.(),
      onSelectionChange: (selection) => callbacks.current.onSelectionChange?.(selection),
      onError: (message, code) => callbacks.current.onError?.(message, code),
      onEvent: (message) => callbacks.current.onEvent?.(message),
    });
    handle.current = mounted;
    return () => {
      mounted.destroy();
      handle.current = null;
    };
  }, [props.src, props.title, props.autoResize]);

  useEffect(() => {
    handle.current?.updateContext(props.context);
  }, [props.context]);

  return <div ref={host} className={props.className} />;
}
