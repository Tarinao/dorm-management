import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './lib/auth';
import { useI18n } from './lib/i18n';
import { configError } from './lib/supabase';
import { AlertBar, Empty, Panel } from './components/ui';
import Layout from './components/Layout';
import Login, { LogoutButton } from './pages/Login';
import Rooms from './pages/Rooms';
import RoomDetail from './pages/RoomDetail';
import Meters from './pages/Meters';
import Billing from './pages/Billing';
import Settings from './pages/Settings';
import Dashboard from './pages/Dashboard';
import Payments from './pages/Payments';
import Receipt from './pages/Receipt';
import Guide from './pages/Guide';
import Reservations from './pages/Reservations';
import Viewings from './pages/Viewings';
import BookingReceipt from './pages/BookingReceipt';
import Maintenance from './pages/Maintenance';
import Invoice, { PublicInvoice } from './pages/Invoice';

/** Staff who type /settings are sent back; the database refuses their writes anyway. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Navigate to="/dashboard" replace state={{ denied: true }} />;
}

export default function App() {
  const { t, lang } = useI18n();
  const { ready, session, role, profile } = useAuth();
  const { pathname } = useLocation();

  if (configError) {
    return <div className="p-6 max-w-[640px] mx-auto"><AlertBar kind="warn">{configError}</AlertBar></div>;
  }
  // The invoice link sent on LINE: opens without logging in (the token is checked by the server).
  if (pathname.startsWith('/i/')) {
    return <Routes><Route path="/i/:token" element={<PublicInvoice />} /></Routes>;
  }
  if (!ready) return <Empty>{t('common.loading')}</Empty>;
  if (!session) return <Login />;
  if (!role) {
    return (
      <div lang={lang} className="min-h-screen flex items-center justify-center p-5">
        <Panel className="max-w-[440px]">
          <h2 className="mt-0">{t('access.waiting_title')}</h2>
          <p className="text-ink-soft">{t('access.waiting_body', { email: profile?.email ?? session.user.email ?? '' })}</p>
          <LogoutButton />
        </Panel>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="bills/:id/invoice" element={<Invoice />} />
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="rooms" element={<Rooms />} />
        <Route path="rooms/:number" element={<RoomDetail />} />
        <Route path="meters" element={<Meters />} />
        <Route path="billing" element={<Billing />} />
        <Route path="payments" element={<Payments />} />
        <Route path="receipts/:id" element={<Receipt />} />
        <Route path="viewings" element={<Viewings />} />
        <Route path="reservations" element={<Reservations />} />
        <Route path="reservations/:id/receipt" element={<BookingReceipt />} />
        <Route path="maintenance" element={<Maintenance />} />
        <Route path="guide" element={<Guide />} />
        <Route path="settings" element={<AdminOnly><Settings /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
