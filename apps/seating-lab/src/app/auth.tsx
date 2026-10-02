import { useState } from 'react';
import { KeyRound, Lock, Server, Shield, Sparkles, User } from 'lucide-react';
import { requestKeycloakToken } from '@tickets/seating';

import { useLab, useRequest } from './state';
import { Button, Modal, Note, Problem, SegmentedControl, Text } from './ui';

const settingsKey = 'seating-lab.signin';

interface SignInSettings {
  authUrl: string;
  realm: string;
  clientId: string;
  username: string;
}

const defaults: SignInSettings = {
  authUrl: '',
  realm: 'Tomcell',
  clientId: 'OrganizerClient',
  username: '',
};

function readSettings(): SignInSettings {
  try {
    const stored = localStorage.getItem(settingsKey);
    return stored ? { ...defaults, ...(JSON.parse(stored) as Partial<SignInSettings>) } : defaults;
  } catch {
    return defaults;
  }
}

/** Общая форма входа: полный экран при первом входе и окно при истёкшей сессии. */
function Credentials({ showAddress }: { showAddress: boolean }) {
  const { connection, signIn } = useLab();
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl);
  const [mode, setMode] = useState<'password' | 'token'>('password');
  const [settings, setSettings] = useState<SignInSettings>(readSettings);
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const { busy, error, run } = useRequest();

  async function login() {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    } catch {
      // Пароль не сохраняется никогда; остальные поля — удобство повторного входа.
    }
    await run(async () => {
      const result = await requestKeycloakToken({ ...settings, password });
      setPassword('');
      signIn({ baseUrl: baseUrl.trim(), token: result.accessToken });
    });
  }

  return (
    <>
      {showAddress ? (
        <div style={{ marginBottom: 16 }}>
          <Text
            label='Адрес сервиса'
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder='http://localhost:5057'
            icon={<Server size={15} />}
          />
        </div>
      ) : null}

      <div style={{ marginBottom: 18 }}>
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: 'password', label: 'По логину и паролю', icon: <Lock size={14} /> },
            { value: 'token', label: 'По токену', icon: <KeyRound size={14} /> },
          ]}
        />
      </div>

      {mode === 'password' ? (
        <>
          <Text
            label='Сервер входа'
            value={settings.authUrl}
            placeholder='http://localhost:8080'
            onChange={(value) => setSettings({ ...settings, authUrl: value })}
            icon={<Shield size={15} />}
          />
          <div className='pair'>
            <Text
              label='Realm'
              value={settings.realm}
              onChange={(value) => setSettings({ ...settings, realm: value })}
            />
            <Text
              label='Приложение'
              value={settings.clientId}
              hint='OrganizerClient или AdminClient'
              onChange={(value) => setSettings({ ...settings, clientId: value })}
            />
          </div>
          <Text
            label='Пользователь'
            value={settings.username}
            onChange={(value) => setSettings({ ...settings, username: value })}
            icon={<User size={15} />}
          />
          <Text
            label='Пароль'
            value={password}
            type='password'
            onChange={setPassword}
            icon={<Lock size={15} />}
          />
          <div style={{ marginTop: 18 }}>
            <Button
              kind='primary'
              full
              disabled={busy || !settings.username || !password}
              onClick={login}
            >
              {busy ? 'Проверяем…' : 'Войти'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Text
            label='Access token'
            value={token}
            type='password'
            onChange={setToken}
            placeholder='eyJhbGciOiJSUzI1NiIsIn...'
            hint='Подойдёт токен, выданный тем же realm'
            icon={<KeyRound size={15} />}
          />
          <div style={{ marginTop: 18 }}>
            <Button
              kind='primary'
              full
              disabled={!token.trim()}
              onClick={() => signIn({ baseUrl: baseUrl.trim(), token: token.trim() })}
            >
              Продолжить
            </Button>
          </div>
        </>
      )}

      <div style={{ marginTop: 14 }}>
        <Problem error={error} />
      </div>

      {mode === 'password' ? (
        <Note tone='info'>
          Вход по паролю работает, если адрес этой страницы разрешён приложению в Keycloak.
          Иначе браузер не получит ответ — тогда воспользуйтесь входом по токену.
        </Note>
      ) : null}
    </>
  );
}

export function SignIn() {
  return (
    <div className='signin'>
      <div className='signin-card'>
        <div className='signin-brand'>
          <Sparkles size={24} color='var(--primary)' />
          <div>
            TomCell <span style={{ color: 'var(--primary)' }}>Studio</span>
          </div>
          <span className='signin-brand-badge'>Конфигуратор</span>
        </div>
        <h1 style={{ fontSize: 20, margin: '14px 0 4px', fontWeight: 700 }}>Вход</h1>
        <p className='signin-lead'>
          Инженерный стенд управления залами, рядами и разметкой мест.
        </p>
        <Credentials showAddress />
      </div>
    </div>
  );
}

export function SessionExpired() {
  return (
    <Modal
      title='Сессия истекла'
      subtitle='Схема на холсте сохранена. Войдите снова, чтобы отправить изменения.'
      onClose={() => undefined}
    >
      <Credentials showAddress={false} />
    </Modal>
  );
}
