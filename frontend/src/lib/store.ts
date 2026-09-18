// Runtime store for session + private key.
// - sessionId: localStorage (survives browser restart)
// - privateKey: sessionStorage (survives refresh in current tab only)
let _privateKey = "";
let _sessionId = "";
const PK_KEY = "runtimePrivateKey";

export const store = {
  getPrivateKey: () => {
    if (_privateKey) return _privateKey;
    const fromSession = sessionStorage.getItem(PK_KEY) || "";
    _privateKey = fromSession;
    return _privateKey;
  },
  setPrivateKey: (pk: string) => {
    _privateKey = pk;
    sessionStorage.setItem(PK_KEY, pk);
  },
  clearPrivateKey: () => {
    _privateKey = "";
    sessionStorage.removeItem(PK_KEY);
  },

  getSessionId: () => _sessionId || localStorage.getItem("sessionId") || "",
  setSessionId: (id: string) => {
    _sessionId = id;
    localStorage.setItem("sessionId", id);
  },
  clearSessionId: () => {
    _sessionId = "";
    localStorage.removeItem("sessionId");
  },
};
