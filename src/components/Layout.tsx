import type { ComponentType } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';
import { useI18n, type TKey } from '../lib/i18n';
import { IconBuilding, IconCalendar, IconChart, IconEye, IconGauge, IconGlobe, IconHelp, IconLogout, IconReceipt, IconSettings, IconWallet, IconWrench, Logo } from './icons';

type Icon = ComponentType<{ size?: number; className?: string }>;
interface NavItem { to: string; key: TKey; icon: Icon; adminOnly?: boolean; mobileBar?: boolean }

/** Pages in menu order. `mobileBar` items sit in the phone's bottom bar; the rest are in the top bar. */
export const NAV: NavItem[] = [
  { to: '/dashboard', key: 'nav.dashboard', icon: IconChart, mobileBar: true },
  { to: '/rooms', key: 'nav.rooms', icon: IconBuilding, mobileBar: true },
  { to: '/meters', key: 'nav.meters', icon: IconGauge, mobileBar: true },
  { to: '/billing', key: 'nav.billing', icon: IconReceipt, mobileBar: true },
  { to: '/payments', key: 'nav.bills', icon: IconWallet, mobileBar: true },
  { to: '/viewings', key: 'nav.viewings', icon: IconEye },
  { to: '/reservations', key: 'nav.reservations', icon: IconCalendar },
  { to: '/maintenance', key: 'nav.maintenance', icon: IconWrench },
  { to: '/guide', key: 'nav.guide', icon: IconHelp },
  { to: '/settings', key: 'nav.settings', icon: IconSettings, adminOnly: true },
];

export default function Layout() {
  const { t, lang, setLang } = useI18n();
  const { isAdmin, profile, signOut } = useAuth();
  const items = NAV.filter((n) => !n.adminOnly || isAdmin);
  const toggleLang = () => setLang(lang === 'th' ? 'en' : 'th');

  return (
    <div lang={lang} className="min-h-screen md:flex">
      {/* ---- desktop sidebar */}
      <aside className="no-print hidden md:flex md:flex-col w-[220px] shrink-0 bg-sidebar text-sidebar-fg px-4 py-6 sticky top-0 h-screen">
        <div className="font-display text-lg font-semibold mb-6 px-2 flex items-center gap-2"><Logo size={24} /> {t('app.name')}</div>
        <nav className="flex flex-col gap-1">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to}
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded no-underline text-[14.5px] ${isActive ? 'bg-white/15 text-white font-semibold' : 'text-sidebar-fg/80 hover:bg-white/10'}`}>
              <n.icon size={19} />{t(n.key)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 text-[13px]">
          <div className="px-2 opacity-70 break-all">{profile?.email}</div>
          <button type="button" onClick={toggleLang} className="flex items-center gap-2 text-left px-3 py-2 rounded border border-white/25 bg-transparent text-sidebar-fg"><IconGlobe size={17} /> {t('common.language')}</button>
          <button type="button" onClick={() => void signOut()} className="flex items-center gap-2 text-left px-3 py-2 rounded border border-white/25 bg-transparent text-sidebar-fg"><IconLogout size={17} /> {t('common.logout')}</button>
        </div>
      </aside>

      {/* ---- phone top bar */}
      <header className="no-print md:hidden sticky top-0 z-40 bg-sidebar text-sidebar-fg flex items-center gap-2 px-4 py-2.5">
        <div className="font-display font-semibold flex-1 truncate flex items-center gap-2"><Logo size={22} /> {t('app.name')}</div>
        {items.filter((n) => !n.mobileBar).map((n) => (
          <NavLink key={n.to} to={n.to} aria-label={t(n.key)} className="no-underline text-sidebar-fg px-1.5 py-1"><n.icon size={21} /></NavLink>
        ))}
        <button type="button" onClick={toggleLang} className="px-2.5 py-1.5 rounded border border-white/30 bg-transparent text-sidebar-fg text-[13px]">
          {lang === 'th' ? 'EN' : 'ไทย'}
        </button>
        <button type="button" onClick={() => void signOut()} aria-label={t('common.logout')} title={t('common.logout')}
          className="px-2 py-1.5 rounded border border-white/30 bg-transparent text-sidebar-fg">
          <IconLogout size={17} />
        </button>
      </header>

      <main className="flex-1 min-w-0 max-w-[1100px] px-4 md:px-10 pt-5 md:pt-8 pb-[calc(90px_+_env(safe-area-inset-bottom,0px))] md:pb-12">
        <Outlet />
      </main>

      {/* ---- phone bottom bar */}
      <nav className="no-print md:hidden fixed bottom-0 inset-x-0 z-40 bg-paper-raised border-t border-line flex pb-[env(safe-area-inset-bottom,0px)]">
        {items.filter((n) => n.mobileBar).map((n) => (
          <NavLink key={n.to} to={n.to}
            className={({ isActive }) => `flex-1 flex flex-col items-center gap-0.5 py-2 no-underline text-[11.5px] ${isActive ? 'text-teal font-semibold' : 'text-muted'}`}>
            <n.icon size={22} />{t(n.key)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
