/* The one Supabase client for the app. URL and key come ONLY from the git-ignored .env
 * (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). The anon/publishable key is safe in a
 * browser: what each user can do is decided by login + the RLS policies in
 * supabase/migrations. Never put the service-role key in a VITE_ variable. */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configError: string | null =
  !url || !key
    ? 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env, fill in both values, and restart `npm run dev`.'
    : null;

// With a config error the app shows a message instead of calling Supabase (see App.tsx).
export const sb = createClient<Database>(url || 'http://invalid.localhost', key || 'missing-key');
