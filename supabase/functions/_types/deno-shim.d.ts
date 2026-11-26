/* Lets `npm run typecheck` check the Edge Functions with plain tsc (no Deno install needed).
 * Only what the functions use: Deno.serve / Deno.env, and the npm: import of supabase-js. */
declare namespace Deno {
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
  const env: { get(name: string): string | undefined };
}
declare module 'npm:@supabase/supabase-js@2.119.2' {
  export * from '@supabase/supabase-js';
}
// Used by the slip / QR helpers; typed loosely here (their own types are not installed).
declare module 'npm:qrcode@1.5.4' { const QRCode: any; export default QRCode; }
declare module 'npm:jpeg-js@0.4.4' { const jpeg: any; export default jpeg; }
declare module 'npm:jsqr@1.4.0' { const jsQR: any; export default jsQR; }
