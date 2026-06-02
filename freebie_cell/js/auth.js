window.FC = window.FC || {};

FC.auth = {
  isSignedIn: false,
  _givenName: null,
  _onSignIn: null,

  init(onSignIn) {
    this._onSignIn = onSignIn;

    if (typeof google === 'undefined') {
      // GSI not loaded (offline or dev) — skip silently
      return;
    }

    google.accounts.id.initialize({
      client_id: FC.googleClientId || '',
      callback: (response) => this._handleCredential(response),
      auto_select: true,
    });

    const btnEl = document.getElementById('gsi-btn');
    if (btnEl) {
      google.accounts.id.renderButton(btnEl, {
        type: 'icon',
        shape: 'circle',
        size: 'small',
      });
    }
    google.accounts.id.prompt();
  },

  _handleCredential(response) {
    const payload = this.decodeJwt(response.credential);
    if (payload && payload.given_name) {
      this._givenName = payload.given_name;
      this.isSignedIn = true;
      if (this._onSignIn) this._onSignIn(this.getUsername());
    }
  },

  decodeJwt(token) {
    try {
      const parts = token.split('.');
      const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(payload));
    } catch (e) {
      return null;
    }
  },

  getUsername() {
    return localStorage.getItem('FC_username') || this._givenName || 'Guest';
  },

  setUsernameOverride(name) {
    localStorage.setItem('FC_username', name);
  },

  clearUsernameOverride() {
    localStorage.removeItem('FC_username');
  },

  signOut() {
    this.isSignedIn = false;
    this._givenName = null;
    if (typeof google !== 'undefined') {
      google.accounts.id.disableAutoSelect();
    }
  },
};
