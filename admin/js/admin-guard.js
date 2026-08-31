(function guardAdminPage() {
  "use strict";

  const authCheck = document.querySelector("#auth-check");
  const authCheckMessage = document.querySelector("#auth-check-message");
  const authProgress = document.querySelector(".auth-progress");
  const retryButton = document.querySelector("#retry-auth");
  const adminApp = document.querySelector("#admin-app");
  const logoutButton = document.querySelector("#logout-button");
  let redirectPending = false;
  let exitIntent = false;
  let verificationGeneration = 0;
  let retryAction = null;

  function concealAdmin() {
    adminApp.hidden = true;
    adminApp.setAttribute("inert", "");
  }

  function showAuthCheck(message, canRetry = false, onRetry = null) {
    concealAdmin();
    authCheck.hidden = false;
    authCheckMessage.textContent = message;
    authProgress.hidden = canRetry;
    retryButton.hidden = !canRetry;
    retryAction = canRetry ? onRetry : null;
  }

  function goToLogin(reason) {
    if (redirectPending) return;
    redirectPending = true;
    const destination = new URL("login.html", window.location.href);
    destination.searchParams.set("reason", reason);
    window.location.replace(destination);
  }

  async function signOutAndRedirect(reason) {
    exitIntent = true;
    const generation = ++verificationGeneration;
    const message = reason === "signed-out"
      ? "Signing out of the Pace Bros administrator workspace."
      : "Access denied. Clearing this browser session.";
    showAuthCheck(message);

    const result = await window.PaceAuth.signOutLocal();
    if (generation !== verificationGeneration) return;

    if (result?.ok) {
      goToLogin(reason);
      return;
    }

    const failureMessage = reason === "signed-out"
      ? "Logout could not be completed. Check your connection and retry."
      : "Access is denied, but this browser session could not be cleared. Check your connection and retry.";
    showAuthCheck(failureMessage, true, () => signOutAndRedirect(reason));
  }

  function revealAdmin(result, generation) {
    if (exitIntent || redirectPending || generation !== verificationGeneration) return;
    authCheck.hidden = true;
    adminApp.hidden = false;
    adminApp.removeAttribute("inert");
    window.PaceAdmin.initialize(result);
  }

  async function verifyAccess() {
    if (exitIntent || redirectPending) return;
    const generation = ++verificationGeneration;
    showAuthCheck("Verifying your Pace Bros administrator session.");
    retryButton.disabled = true;

    try {
      if (!window.PaceAuth) {
        showAuthCheck("Administrator authentication could not be loaded. Check your connection and retry.", true);
        return;
      }

      const result = await window.PaceAuth.authorizeSession();
      if (generation !== verificationGeneration || exitIntent || redirectPending) return;

      if (result.status === "authorized") {
        revealAdmin(result, generation);
        return;
      }

      if (result.status === "unauthorized") {
        await signOutAndRedirect("unauthorized");
        return;
      }

      if (result.status === "anonymous") {
        goToLogin(result.reason === "session-expired" ? "session-expired" : "session-required");
        return;
      }

      showAuthCheck(
        "Administrator access could not be verified. Check your connection and retry.",
        true,
        verifyAccess,
      );
    } catch {
      if (generation !== verificationGeneration || exitIntent || redirectPending) return;
      showAuthCheck(
        "Administrator access could not be verified. Check your connection and retry.",
        true,
        verifyAccess,
      );
    } finally {
      if (generation === verificationGeneration) retryButton.disabled = false;
    }
  }

  retryButton.addEventListener("click", () => {
    if (!retryAction) return;
    retryButton.disabled = true;
    Promise.resolve(retryAction()).catch(() => {
      showAuthCheck("The request could not be completed. Check your connection and retry.", true, retryAction);
    });
  });
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out…";
    try {
      await signOutAndRedirect("signed-out");
    } catch {
      showAuthCheck(
        "Logout could not be completed. Check your connection and retry.",
        true,
        () => signOutAndRedirect("signed-out"),
      );
    }
  });

  if (window.PaceSupabase) {
    window.PaceSupabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        concealAdmin();
        if (!exitIntent) {
          exitIntent = true;
          verificationGeneration += 1;
          goToLogin("session-expired");
        }
      }

      if (event === "TOKEN_REFRESHED" && !redirectPending && !exitIntent) {
        window.setTimeout(verifyAccess, 0);
      }
    });
  }

  verifyAccess();
})();
