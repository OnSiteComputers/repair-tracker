/* =====================================================================
   CONFIG — Repair Tracker

   You only need two values here now. Editing the tracker uses a real
   login (the email/password you create in Supabase), so there is NO
   password stored in this file anymore — that's the security fix.

   See the SECURITY-UPGRADE guide for the one-time steps.
   ===================================================================== */

window.REPAIR_TRACKER_CONFIG = {
  // 1) Your Supabase Project URL (the part before /rest/v1/)
  //    Yours: https://pnghrbplmkspvhkdgpou.supabase.co
  SUPABASE_URL: "https://pnghrbplmkspvhkdgpou.supabase.co",

  // 2) Your Supabase browser key — the "Publishable key"
  //    (Project Settings -> API Keys -> Publishable and secret API keys).
  //    Starts with sb_publishable_...  This is safe to be public.
  SUPABASE_ANON_KEY: "PASTE_YOUR_PUBLISHABLE_KEY_HERE",
};
