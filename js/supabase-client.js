(function createPaceSupabaseClient(global) {
  "use strict";

  const SUPABASE_URL = "https://dlpxhhhcrgttbpdqbxno.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_dQGqDdeAbpzBLa6BLiP_Jw_QXbhOUR-";

  if (!global.supabase || typeof global.supabase.createClient !== "function") {
    global.PaceSupabase = null;
    return;
  }

  global.PaceSupabase = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    db: { schema: "public" },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "pace-bros-visuals-admin-auth",
    },
  });
})(window);
