import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { SeatingApi, decodeTokenClaims, type ApiExchange } from '@tickets/seating';

const storageKey = 'seating-lab.connection';
const maxExchanges = 120;

export interface Connection {
  baseUrl: string;
  token: string;
}

const emptyConnection: Connection = { baseUrl: 'http://localhost:5057', token: '' };

function readConnection(): Connection {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return emptyConnection;
    const parsed = JSON.parse(stored) as Partial<Connection>;
    return { baseUrl: parsed.baseUrl || emptyConnection.baseUrl, token: parsed.token ?? '' };
  } catch {
    return emptyConnection;
  }
}

export interface LabValue {
  connection: Connection;
  signIn: (next: Connection) => void;
  signOut: () => void;
  signedIn: boolean;
  /** Сервер отверг токен: работа на экране цела, нужен повторный вход. */
  expired: boolean;
  subject: string;
  api: SeatingApi;
  exchanges: ApiExchange[];
  clearExchanges: () => void;
}

const LabContext = createContext<LabValue | null>(null);

export function LabProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection>(readConnection);
  const [exchanges, setExchanges] = useState<ApiExchange[]>([]);
  const [expired, setExpired] = useState(false);

  const store = useCallback((next: Connection) => {
    setConnection(next);
    setExpired(false);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Приватный режим браузера: работа продолжается без сохранения настроек.
    }
  }, []);

  const api = useMemo(() => new SeatingApi({
    baseUrl: connection.baseUrl,
    token: connection.token,
    onExchange: (exchange) => {
      setExchanges((current) => [exchange, ...current].slice(0, maxExchanges));
      // Токен отвергнут: просим войти заново, но не стираем несохранённую работу на экране.
      if (exchange.status === 401) setExpired(true);
    },
  }), [connection.baseUrl, connection.token]);

  const subject = useMemo(() => {
    const claims = connection.token ? decodeTokenClaims(connection.token) : null;
    return String(claims?.['preferred_username'] ?? claims?.['sub'] ?? '');
  }, [connection.token]);

  const value = useMemo<LabValue>(() => ({
    connection,
    signIn: store,
    signOut: () => store({ baseUrl: connection.baseUrl, token: '' }),
    signedIn: Boolean(connection.token),
    expired,
    subject,
    api,
    exchanges,
    clearExchanges: () => setExchanges([]),
  }), [connection, store, expired, subject, api, exchanges]);

  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLab(): LabValue {
  const value = useContext(LabContext);
  if (!value) throw new Error('LabProvider отсутствует в дереве компонентов.');
  return value;
}

/** Один запрос: занятость и последняя ошибка, без ручного try/catch в каждом экране. */
export function useRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (reason) {
      setError(reason);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
