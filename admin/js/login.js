(function initializeLogin() {
  "use strict";

  const form = document.querySelector("#login-form");
  const emailInput = document.querySelector("#login-email");
  const passwordInput = document.querySelector("#login-password");
  const loginButton = document.querySelector("#login-button");
  const loginButtonLabel = document.querySelector("#login-button-label");
  const message = document.querySelector("#login-message");
  let requestInFlight = false;

  function setMessage(text, kind = "") {
    message.textContent = text;
    message.className = `login-message${kind ? ` is-${kind}` : ""}`;
  }

  function setBusy(isBusy, label = "Login") {
    requestInFlight = isBusy;
    form.setAttribute("aria-busy", String(isBusy));
    emailInput.disabled = isBusy;
    passwordInput.disabled = isBusy;
    loginButton.disabled = isBusy;
    loginButtonLabel.textContent = label;
  }

  function goToAdmin() {
    window.location.replace(new URL("./", window.location.href));
  }

  async function clearUnauthorizedSession() {
    const result = await window.PaceAuth.signOutLocal();
    return result?.ok === true;
  }

  async function checkExistingSession() {
    setBusy(true, "Checking access…");

    try {
      const result = await window.PaceAuth.authorizeSession();

      if (result.status === "authorized") {
        goToAdmin();
        return;
      }

      if (result.status === "unauthorized") {
        const sessionCleared = await clearUnauthorizedSession();
        setMessage(
          sessionCleared
            ? "This account is not authorized for Pace Bros administration."
            : "Access is denied, but this browser session could not be cleared. Check your connection and reload.",
          "error",
        );
      } else if (result.status === "error") {
        setMessage("Administrator access could not be verified. Please try again.", "error");
      } else {
        const reason = new URLSearchParams(window.location.search).get("reason");
        if (reason === "signed-out") setMessage("You have been signed out.", "success");
        if (reason === "session-required") setMessage("Please log in to continue.");
        if (reason === "session-expired") setMessage("Your session has expired. Please log in again.");
        if (reason === "unauthorized") {
          setMessage("This account is not authorized for Pace Bros administration.", "error");
        }
      }
    } catch {
      setMessage("Administrator access could not be verified. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (requestInFlight) return;

    form.classList.add("was-validated");
    if (!form.reportValidity()) return;

    setMessage("");
    setBusy(true, "Logging in…");

    try {
      if (!window.PaceSupabase || !window.PaceAuth) throw new Error("Authentication unavailable");

      const { data, error } = await window.PaceSupabase.auth.signInWithPassword({
        email: emailInput.value.trim(),
        password: passwordInput.value,
      });

      if (error || !data.user) {
        passwordInput.value = "";
        setMessage("Email or password not recognized.", "error");
        return;
      }

      const authorization = await window.PaceAuth.authorizeUser(data.user);

      if (authorization.status === "authorized") {
        goToAdmin();
        return;
      }

      passwordInput.value = "";
      if (authorization.status === "unauthorized") {
        const sessionCleared = await clearUnauthorizedSession();
        setMessage(
          sessionCleared
            ? "This account is not authorized for Pace Bros administration."
            : "Access is denied, but this browser session could not be cleared. Check your connection and reload.",
          "error",
        );
        return;
      }

      setMessage("Administrator access could not be verified. Please try again.", "error");
    } catch {
      passwordInput.value = "";
      setMessage("Administrator login is temporarily unavailable. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("submit", handleLogin);
  checkExistingSession();
})();
