(function exposePaceAuth(global) {
  "use strict";

  function clientUnavailable() {
    return { status: "error", reason: "client-unavailable" };
  }

  function isInvalidSessionError(error) {
    if (!error) return false;

    const invalidSessionCodes = new Set([
      "bad_jwt",
      "refresh_token_already_used",
      "refresh_token_not_found",
      "session_not_found",
    ]);

    return error.name === "AuthSessionMissingError"
      || Number(error.status) === 401
      || invalidSessionCodes.has(error.code);
  }

  async function authorizeUser(user) {
    if (!global.PaceSupabase || !user || !user.id) return clientUnavailable();

    const { data: adminProfile, error } = await global.PaceSupabase
      .from("admin_users")
      .select("user_id, display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return { status: "error", reason: "authorization-check-failed" };
    if (!adminProfile) return { status: "unauthorized", user };

    return { status: "authorized", user, adminProfile };
  }

  async function authorizeSession() {
    if (!global.PaceSupabase) return clientUnavailable();

    const {
      data: { session },
      error: sessionError,
    } = await global.PaceSupabase.auth.getSession();

    if (sessionError) {
      return isInvalidSessionError(sessionError)
        ? { status: "anonymous", reason: "session-expired" }
        : { status: "error", reason: "session-check-failed" };
    }
    if (!session) return { status: "anonymous" };

    const {
      data: { user },
      error: userError,
    } = await global.PaceSupabase.auth.getUser();

    if (userError) {
      return isInvalidSessionError(userError)
        ? { status: "anonymous", reason: "session-expired" }
        : { status: "error", reason: "session-validation-failed" };
    }
    if (!user) return { status: "anonymous" };
    return authorizeUser(user);
  }

  async function signOutLocal() {
    if (!global.PaceSupabase) return { ok: false };

    try {
      await global.PaceSupabase.auth.signOut({ scope: "local" });

      const {
        data: { session },
        error: sessionError,
      } = await global.PaceSupabase.auth.getSession();

      return { ok: !sessionError && !session };
    } catch {
      return { ok: false };
    }
  }

  global.PaceAuth = Object.freeze({
    authorizeSession,
    authorizeUser,
    signOutLocal,
  });
})(window);
