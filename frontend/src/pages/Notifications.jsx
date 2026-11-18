import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { PageTitle } from '../components/ui';
import { Tabs } from '../components/Tabs';
import { Inbox } from './notifications/Inbox';
import { Settings } from './notifications/Settings';
import { NotificationHistory, NotificationStats } from './notifications/AdminPanel';

const USER_TABS = [{ id: 'bandeja', label: 'Bandeja' }, { id: 'ajustes', label: 'Preferencias y dispositivos' }];
const ADMIN_TABS = [{ id: 'metricas', label: 'Métricas' }, { id: 'historial', label: 'Historial de envíos' }];

/** Notificaciones: bandeja y preferencias de cada usuario; métricas e historial para la administración. */
export default function Notifications() {
  const { is } = useAuth();
  const tabs = is('admin') ? [...USER_TABS, ...ADMIN_TABS] : USER_TABS;
  const [params, setParams] = useSearchParams();
  const tab = tabs.some((t) => t.id === params.get('tab')) ? params.get('tab') : tabs[0].id;
  const setTab = (id) => setParams({ tab: id }, { replace: true });

  return (
    <div>
      <PageTitle>Notificaciones</PageTitle>
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Secciones de notificaciones" />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'bandeja' && <Inbox />}
        {tab === 'ajustes' && <Settings />}
        {tab === 'metricas' && <NotificationStats />}
        {tab === 'historial' && <NotificationHistory />}
      </div>
    </div>
  );
}
