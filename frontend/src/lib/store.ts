// Runtime store for session + private key.
// - sessionId: localStorage (survives browser restart)
// - privateKey: sessionStorage (survives refresh in current tab only)
let _privateKey = "";
let _sessionId = "";
const PK_KEY = "runtimePrivateKey";

/** How the current signing wallet is provided: pasted key or browser wallet. */
export type SignerMode =
  | { mode: "pk"; privateKey: string }
  | { mode: "wallet"; address: string }
  | null;

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

  /**
   * The active signer, whichever mode the user chose. Wallet mode never
   * carries key material — only the address (signing happens in-browser).
   */
  getSigner: (): SignerMode => {
    const walletAddress = localStorage.getItem("walletAddress");
    if (walletAddress) return { mode: "wallet", address: walletAddress };
    const pk = store.getPrivateKey();
    if (pk) return { mode: "pk", privateKey: pk };
    return null;
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
