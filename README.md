# Ledger — Dorm Manager (React + TypeScript + Tailwind)

Port of the original single-file `index.html` to Vite + React 19 + TypeScript + Tailwind CSS v4.
Same Supabase backend, same tables, same behaviour.

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + build → dist/index.html (one self-contained file)
npm run preview    # serve the built file
```

`npm run build` inlines all JS and CSS, so `dist/index.html` is a drop-in replacement for the old standalone file.

## Layout

| Path | What |
| --- | --- |
| `src/lib/db.ts` | Supabase client + rooms/tenants, invoices, repairs, settings queries |
| `src/lib/i18n.ts` | EN / TH translations (copied verbatim from the original) |
| `src/lib/format.ts` | money/date helpers, LINE message, CSV download, clipboard |
| `src/lib/promptpay.ts` | PromptPay EMVCo QR payload |
| `src/state/LedgerContext.tsx` | app state, auth, loading, toasts, confirm dialog |
| `src/pages/*` | Overview, Rooms, Billing, Invoices, Repairs, Reports, Settings |
| `src/components/*` | Sidebar, Login, modals, shared Tailwind UI pieces |
| `src/index.css` | Tailwind import + colour tokens (light/dark) |
