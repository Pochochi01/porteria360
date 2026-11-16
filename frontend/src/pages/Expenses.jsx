import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { PageTitle } from '../components/ui';
import { Tabs } from '../components/Tabs';
import Transparency from './expenses/Transparency';
import { currentPeriod } from '../lib/format';
import Settlements from './expenses/Settlements';
import { OwnerAccount, OwnerHistory } from './expenses/OwnerPortal';
import { Categories, ExpenseConfig, ExpenseDashboard, Expenditures, GenerateExpenses, PaymentMethodsAdmin, Suppliers } from './expenses/AdminPanels';

const ADMIN_TABS = [
  { id: 'resumen', label: 'Resumen' }, { id: 'gastos', label: 'Gastos' }, { id: 'transparencia', label: 'Gastos del período' },
  { id: 'liquidar', label: 'Liquidar' }, { id: 'liquidaciones', label: 'Liquidaciones' }, { id: 'rubros', label: 'Rubros' },
  { id: 'proveedores', label: 'Proveedores' }, { id: 'medios', label: 'Medios de pago' }, { id: 'config', label: 'Configuración' },
];
const OWNER_TABS = [{ id: 'cuenta', label: 'Mi cuenta' }, { id: 'transparencia', label: 'Gastos del período' }, { id: 'historial', label: 'Historial' }];

/** Módulo de expensas: administración (gastos, liquidación, cobranza) y portal del propietario. */
export default function Expenses() {
  const { is } = useAuth();
  const admin = is('admin');
  const tabs = admin ? ADMIN_TABS : OWNER_TABS;
  const [params, setParams] = useSearchParams();
  // Vuelta de Mercado Pago: ?mp=… (OAuth) → configuración; ?pago=… (cobro) → mi cuenta
  const fallback = params.get('mp') ? 'config' : tabs[0].id;
  const tab = tabs.some((t) => t.id === params.get('tab')) ? params.get('tab') : fallback;
  const setTab = (id) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', id); n.delete('mp'); n.delete('pago'); return n; }, { replace: true });
  const [period, setPeriod] = useState(currentPeriod);
  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey((k) => k + 1);

  return (
    <div>
      <PageTitle>Expensas</PageTitle>
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Secciones de expensas" />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'resumen' && <ExpenseDashboard period={period} onPeriod={setPeriod} />}
        {tab === 'gastos' && <Expenditures period={period} onPeriod={setPeriod} />}
        {tab === 'transparencia' && <Transparency period={period} onPeriod={setPeriod} />}
        {tab === 'liquidar' && <GenerateExpenses period={period} onPeriod={setPeriod} onDone={bump} />}
        {tab === 'liquidaciones' && <Settlements reloadKey={reloadKey} />}
        {tab === 'rubros' && <Categories />}
        {tab === 'proveedores' && <Suppliers />}
        {tab === 'medios' && <PaymentMethodsAdmin />}
        {tab === 'config' && <ExpenseConfig />}
        {tab === 'cuenta' && <OwnerAccount />}
        {tab === 'historial' && <OwnerHistory />}
      </div>
    </div>
  );
}
