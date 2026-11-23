/* Small inline SVG icon set (24×24, stroke = currentColor), so no icon package is needed.
 * Colour comes from the text colour of the parent (e.g. className="text-sage"). */
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number; title?: string };

function Svg({ size = 20, title, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} {...rest}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/* ---- house outline shared by the room-status icons */
const Roof = () => <path d="M2.5 11 12 3.5 21.5 11" />;
const Walls = () => <path d="M5 9.6V20.5h14V9.6" />;

/** Vacant: door standing open. */
export const HomeOpen = (p: IconProps) => (
  <Svg {...p}>
    <Roof /><Walls />
    <path d="M10 20.5v-6.5h4v6.5" strokeDasharray="2 1.6" />
    <path d="M10 14 7.6 15.3v6" />
  </Svg>
);

/** Occupied: door shut. */
export const HomeClosed = (p: IconProps) => (
  <Svg {...p}>
    <Roof /><Walls />
    <rect x="10" y="14" width="4" height="6.5" rx="0.4" fill="currentColor" />
  </Svg>
);

/** Reserved: house with a calendar-check badge. */
export const HomeReserved = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 11 12 3.5l5 4" /><path d="M5 9.6V20.5h7" />
    <rect x="13.5" y="12" width="8" height="8.5" rx="1.2" />
    <path d="M13.5 15h8M16 10.8v2.2M19 10.8v2.2" />
    <path d="m15.6 17.6 1.3 1.2 2.4-2.4" />
  </Svg>
);

/** Maintenance: house with a wrench badge. */
export const HomeMaintenance = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 11 12 3.5l5 4" /><path d="M5 9.6V20.5h7" />
    <path d="M20.6 13.3a3 3 0 0 1-3.9 3.9l-2.6 2.6a1.2 1.2 0 0 1-1.7-1.7l2.6-2.6a3 3 0 0 1 3.9-3.9l-1.8 1.8.3 1.4 1.4.3z" />
  </Svg>
);

export function RoomStatusIcon({ status, size = 28 }: { status: string; size?: number }) {
  switch (status) {
    case 'occupied': return <HomeClosed size={size} className="text-sage" />;
    case 'reserved': return <HomeReserved size={size} className="text-teal" />;
    case 'maintenance': return <HomeMaintenance size={size} className="text-amber" />;
    default: return <HomeOpen size={size} className="text-muted" />;
  }
}

/* ---- navigation & general */
export const IconBuilding = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10.5 21v-3h3v3" /></Svg>
);
export const IconGauge = (p: IconProps) => (
  <Svg {...p}><path d="M4 16a8 8 0 1 1 16 0" /><path d="m12 16 4-5" /><circle cx="12" cy="16" r="1.2" fill="currentColor" /><path d="M3 20h18" /></Svg>
);
export const IconReceipt = (p: IconProps) => (
  <Svg {...p}><path d="M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21z" /><path d="M9 8h6M9 12h6M9 16h3" /></Svg>
);
export const IconWallet = (p: IconProps) => (
  <Svg {...p}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4" /><rect x="4" y="7.5" width="16" height="12" rx="2" /><circle cx="16" cy="13.5" r="1.2" fill="currentColor" /></Svg>
);
export const IconChart = (p: IconProps) => (
  <Svg {...p}><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></Svg>
);
export const IconHelp = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></Svg>
);
export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);
export const IconZap = (p: IconProps) => <Svg {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></Svg>;
export const IconDroplet = (p: IconProps) => <Svg {...p}><path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z" /></Svg>;
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Svg>
);
export const IconLogout = (p: IconProps) => (
  <Svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></Svg>
);
export const IconX = (p: IconProps) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconArrowLeft = (p: IconProps) => <Svg {...p}><path d="M19 12H5M11 18l-6-6 6-6" /></Svg>;
export const IconPrinter = (p: IconProps) => (
  <Svg {...p}><path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><rect x="7" y="14" width="10" height="7" /></Svg>
);
export const IconUsers = (p: IconProps) => (
  <Svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 4.6a3.2 3.2 0 0 1 0 6.4M18 14.3a6 6 0 0 1 3 5.2" /></Svg>
);
export const IconAlert = (p: IconProps) => (
  <Svg {...p}><path d="M12 3 2 20h20z" /><path d="M12 10v4" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></Svg>
);

/** App logo: a key in a rounded square. */
export const Logo = (p: IconProps) => (
  <Svg {...p}><rect x="2.5" y="2.5" width="19" height="19" rx="5" /><circle cx="9" cy="12" r="2.6" /><path d="M11.6 12H17.5v2.4M15 12v1.8" /></Svg>
);
