# Taieri Post – driver & owner portals

Real-time replacement for the Run Board, Scorecard and driver portal artifacts.

- `web/` – static site served by Render (driver app + owner portal)
- `supabase/migrations/` – database schema, security rules and realtime setup

Stack: Supabase (database, auth, realtime, edge functions) · Render (static hosting) · Resend (email).
