/** Persistance locale du HF Token (hors options profil) — clé stable pour ne pas perdre le token entre sessions. */
export const HF_TOKEN_STORAGE_KEY = "lx-studio-hf-token";

export function readStoredHfToken(): string {
  try {
    return localStorage.getItem(HF_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredHfToken(token: string): void {
  try {
    if (token.trim()) {
      localStorage.setItem(HF_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(HF_TOKEN_STORAGE_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}
