import { useCallback, useState, type ReactNode } from 'react';
import {
  Compass,
  Coins,
  ClipboardCheck,
  Eye,
  FileSpreadsheet,
  LayoutGrid,
  Link2,
  LogOut,
  MapPin,
  MonitorPlay,
  ShieldCheck,
  Sparkles,
  Terminal,
  Ticket,
  Waypoints,
  UserCheck,
} from 'lucide-react';
import type { SeatingConfigurationResult } from '@tickets/seating';

import { SessionExpired, SignIn } from './auth';
import { AdminModerationPage } from './admin-moderation';
import { Configurator } from './configurator';
import { DevDrawer } from './devtools';
import { EmbedGuidePage } from './embed-guide';
import { useDirectory } from './directory';
import { HallsPage } from './halls';
import { JourneyPage } from './journey';
import { MyTicketsPage } from './my-tickets';
import { OccurrenceSalesPage } from './occurrence-sales';
import { PricesPage } from './prices';
import { RegistryPage } from './registry';
import { RoadmapPage } from './roadmap';
import { ShowcasePage } from './showcase';
import { LabProvider, useLab } from './state';
import { VenuesPage } from './venues';

type Role = 'organizer' | 'admin' | 'customer';

type Route =
  | { name: 'halls' }
  | { name: 'venues' }
  | { name: 'registry' }
  | { name: 'showcase'; hallId?: string }
  | { name: 'roadmap' }
  | { name: 'journey' }
  | { name: 'moderation' }
  | { name: 'embedGuide' }
  | { name: 'prices' }
  | { name: 'occurrenceSales' }
  | { name: 'myTickets' }
  | { name: 'configurator'; hall: SeatingConfigurationResult };

interface RoleDefinition {
  id: Role;
  title: string;
  icon: ReactNode;
}

const roles: RoleDefinition[] = [
  { id: 'organizer', title: 'Организатор', icon: <UserCheck size={16} /> },
  { id: 'admin', title: 'Администратор', icon: <ShieldCheck size={16} /> },
  { id: 'customer', title: 'Витрина покупателя', icon: <Eye size={16} /> },
];

interface MenuItem {
  route: Route['name'];
  title: string;
  icon: ReactNode;
}

const menu: Record<Role, MenuItem[]> = {
  organizer: [
    { route: 'journey', title: 'Путь до продаж', icon: <Waypoints size={16} /> },
    { route: 'halls', title: 'Залы', icon: <LayoutGrid size={16} /> },
    { route: 'prices', title: 'Цены', icon: <Coins size={16} /> },
    { route: 'occurrenceSales', title: 'Показ: продажи', icon: <Ticket size={16} /> },
    { route: 'embedGuide', title: 'Встраивание виджета', icon: <Link2 size={16} /> },
    { route: 'roadmap', title: 'Что появится позже', icon: <Compass size={16} /> },
  ],
  admin: [
    { route: 'moderation', title: 'Модерация', icon: <ClipboardCheck size={16} /> },
    { route: 'halls', title: 'Залы', icon: <LayoutGrid size={16} /> },
    { route: 'venues', title: 'Площадки и помещения', icon: <MapPin size={16} /> },
    { route: 'registry', title: 'Реестр залов (XLSX)', icon: <FileSpreadsheet size={16} /> },
    { route: 'occurrenceSales', title: 'Показ: продажи', icon: <Ticket size={16} /> },
    { route: 'embedGuide', title: 'Встраивание виджета', icon: <Link2 size={16} /> },
    { route: 'roadmap', title: 'Что появится позже', icon: <Compass size={16} /> },
  ],
  customer: [
    { route: 'showcase', title: 'Витрина покупателя', icon: <MonitorPlay size={16} /> },
    { route: 'myTickets', title: 'Мои билеты', icon: <Ticket size={16} /> },
    { route: 'embedGuide', title: 'Встраивание виджета', icon: <Link2 size={16} /> },
    { route: 'roadmap', title: 'Что появится позже', icon: <Compass size={16} /> },
  ],
};

function Workspace() {
  const { signedIn, expired, subject, signOut, connection, exchanges } = useLab();
  const [role, setRole] = useState<Role>('organizer');
  const [route, setRoute] = useState<Route>({ name: 'journey' });
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState('');
  const [dev, setDev] = useState(false);
  const [spaceForm, setSpaceForm] = useState(false);
  const directory = useDirectory();

  const handleBack = useCallback(() => setRoute({ name: 'halls' }), []);
  const handleJourneySelection = useCallback((eventId: string, occurrenceId: string) => {
    setSelectedEventId(eventId);
    setSelectedOccurrenceId(occurrenceId);
  }, []);
  const handlePreview = useCallback((hall: SeatingConfigurationResult) => {
    setRole('customer');
    setRoute({ name: 'showcase', hallId: hall.id });
  }, []);
  const handleHallChanged = useCallback((hall: SeatingConfigurationResult) => {
    setRoute((prev) => {
      if (prev.name === 'configurator' && prev.hall.id === hall.id && prev.hall.versions.configurationVersion === hall.versions.configurationVersion) {
        return prev;
      }
      return { name: 'configurator', hall };
    });
  }, []);

  if (!signedIn) return <SignIn />;

  function go(newRole: Role) {
    setRole(newRole);
    setRoute(newRole === 'customer' ? { name: 'showcase' } : newRole === 'admin' ? { name: 'moderation' } : { name: 'journey' });
  }

  if (route.name === 'configurator')
    return (
      <>
        <Configurator
          hall={route.hall}
          onBack={handleBack}
          onPreview={handlePreview}
          onHallChanged={handleHallChanged}
        />
        {expired ? <SessionExpired /> : null}
      </>
    );

  const initials = (subject || 'TC').slice(0, 2).toUpperCase();

  return (
    <div className='shell'>
      <nav className='side' aria-label='Навигация TomCell'>
        <div className='side-brand'>
          <div className='side-brand-title'>
            <Sparkles size={20} color='var(--primary)' />
            <div>
              TomCell <span>Studio</span>
            </div>
          </div>
          <span className='side-brand-tag'>Labs</span>
        </div>

        <div>
          <div className='side-section-label'>Режим работы</div>
          <div className='side-roles'>
            {roles.map((item) => (
              <button
                key={item.id}
                type='button'
                className={role === item.id ? 'on' : undefined}
                aria-current={role === item.id}
                onClick={() => go(item.id)}
                title={item.title}
              >
                {item.icon}
                <span>{item.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className='side-section-label'>Разделы</div>
          <ul className='menu'>
            {menu[role].map((item) => (
              <li key={item.route}>
                <button
                  type='button'
                  className={`menu-btn ${route.name === item.route ? 'on' : ''}`}
                  onClick={() => setRoute({ name: item.route } as Route)}
                >
                  {item.icon}
                  <span>{item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className='side-foot'>
          <div className='side-connection' title={connection.baseUrl}>
            <span className='side-connection-dot' />
            <span className='mono' style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {connection.baseUrl.replace(/^https?:\/\//, '')}
            </span>
          </div>

          <div className='side-user'>
            <div className='side-avatar'>{initials}</div>
            <div className='side-user-meta'>
              <span className='side-user-name' title={subject}>
                {subject || 'Пользователь'}
              </span>
              <span className='side-user-role'>
                {role === 'admin' ? 'Администратор' : role === 'organizer' ? 'Организатор' : 'Витрина'}
              </span>
            </div>
          </div>

          <button
            type='button'
            className='link'
            style={{ color: '#94a3b8', fontSize: 12 }}
            onClick={() => setDev((value) => !value)}
          >
            <Terminal size={14} />
            <span>Инженерная панель</span>
            {exchanges.length ? (
              <span
                style={{
                  marginLeft: 'auto',
                  background: 'rgba(255,255,255,0.1)',
                  padding: '2px 6px',
                  borderRadius: 10,
                  fontSize: 10,
                }}
              >
                {exchanges.length}
              </span>
            ) : null}
          </button>

          <button
            type='button'
            className='link'
            style={{ color: '#f87171', fontSize: 12 }}
            onClick={signOut}
          >
            <LogOut size={14} />
            <span>Выйти из аккаунта</span>
          </button>
        </div>
      </nav>

      <main className='content'>
        {route.name === 'halls' ? (
          <HallsPage
            directory={directory}
            isAdmin={role === 'admin'}
            onOpen={(hall) => setRoute({ name: 'configurator', hall })}
            onCreateSpace={() => {
              setRole('admin');
              setSpaceForm(true);
              setRoute({ name: 'venues' });
            }}
          />
        ) : null}

        {route.name === 'venues' ? (
          <VenuesPage
            directory={directory}
            openSpaceForm={spaceForm}
            onSpaceFormClosed={() => setSpaceForm(false)}
          />
        ) : null}

        {route.name === 'registry' ? <RegistryPage /> : null}

        {route.name === 'journey' ? <JourneyPage selectedEventId={selectedEventId} selectedOccurrenceId={selectedOccurrenceId} onSelect={handleJourneySelection} onHalls={() => setRoute({ name: 'halls' })} onSales={() => setRoute({ name: 'occurrenceSales' })} onEmbed={() => setRoute({ name: 'embedGuide' })} /> : null}

        {route.name === 'moderation' ? <AdminModerationPage /> : null}

        {route.name === 'embedGuide' ? <EmbedGuidePage occurrenceId={selectedOccurrenceId} /> : null}

        {route.name === 'prices' ? <PricesPage /> : null}

        {route.name === 'occurrenceSales' ? <OccurrenceSalesPage isAdmin={role === 'admin'} initialEventId={selectedEventId} initialOccurrenceId={selectedOccurrenceId} /> : null}

        {route.name === 'showcase' ? <ShowcasePage initialHallId={route.hallId} /> : null}

        {route.name === 'myTickets' ? <MyTicketsPage /> : null}

        {route.name === 'roadmap' ? <RoadmapPage surface={role} /> : null}
      </main>

      {dev ? <DevDrawer onClose={() => setDev(false)} /> : null}
      {expired ? <SessionExpired /> : null}
    </div>
  );
}

export function App() {
  return (
    <LabProvider>
      <Workspace />
    </LabProvider>
  );
}

export default App;
