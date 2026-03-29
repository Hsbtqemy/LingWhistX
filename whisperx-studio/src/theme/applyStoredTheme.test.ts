/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyStoredTheme,
  applyThemeFromStorageEvent,
  getEffectiveColorScheme,
  LX_THEME_CHANGED_EVENT,
  LX_THEME_STORAGE_KEY,
  readStoredThemePreference,
  setThemePreference,
} from "./applyStoredTheme";

describe("applyStoredTheme / thème", () => {
  beforeEach(() => {
    try {
      localStorage.removeItem(LX_THEME_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    document.documentElement.removeAttribute("data-lx-theme");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("readStoredThemePreference : system si absent ou invalide", () => {
    expect(readStoredThemePreference()).toBe("system");
    localStorage.setItem(LX_THEME_STORAGE_KEY, "  LIGHT  ");
    expect(readStoredThemePreference()).toBe("light");
    localStorage.setItem(LX_THEME_STORAGE_KEY, "bogus");
    expect(readStoredThemePreference()).toBe("system");
  });

  it("setThemePreference : persiste light / dark et met data-lx-theme", () => {
    setThemePreference("dark");
    expect(localStorage.getItem(LX_THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-lx-theme")).toBe("dark");

    setThemePreference("light");
    expect(localStorage.getItem(LX_THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-lx-theme")).toBe("light");
  });

  it("setThemePreference('system') : persiste system et met data-lx-theme=system", () => {
    setThemePreference("dark");
    setThemePreference("system");
    expect(localStorage.getItem(LX_THEME_STORAGE_KEY)).toBe("system");
    expect(document.documentElement.getAttribute("data-lx-theme")).toBe("system");
  });

  it("applyStoredTheme : aligne le DOM sur localStorage", () => {
    localStorage.setItem(LX_THEME_STORAGE_KEY, "light");
    document.documentElement.removeAttribute("data-lx-theme");
    applyStoredTheme();
    expect(document.documentElement.getAttribute("data-lx-theme")).toBe("light");
  });

  it("setThemePreference émet LX_THEME_CHANGED_EVENT", () => {
    const spy = vi.fn();
    window.addEventListener(LX_THEME_CHANGED_EVENT, spy);
    setThemePreference("dark");
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(LX_THEME_CHANGED_EVENT, spy);
  });

  it("applyThemeFromStorageEvent : ignore une autre clé", () => {
    localStorage.setItem(LX_THEME_STORAGE_KEY, "dark");
    document.documentElement.removeAttribute("data-lx-theme");
    const spy = vi.fn();
    window.addEventListener(LX_THEME_CHANGED_EVENT, spy);

    applyThemeFromStorageEvent(
      new StorageEvent("storage", {
        key: "other-key",
        newValue: "x",
        storageArea: localStorage,
      }),
    );

    expect(document.documentElement.getAttribute("data-lx-theme")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener(LX_THEME_CHANGED_EVENT, spy);
  });

  it("applyThemeFromStorageEvent : lx-theme met à jour le DOM et notifie", () => {
    localStorage.setItem(LX_THEME_STORAGE_KEY, "dark");
    document.documentElement.removeAttribute("data-lx-theme");
    const spy = vi.fn();
    window.addEventListener(LX_THEME_CHANGED_EVENT, spy);

    applyThemeFromStorageEvent(
      new StorageEvent("storage", {
        key: LX_THEME_STORAGE_KEY,
        newValue: "dark",
        storageArea: localStorage,
      }),
    );

    expect(document.documentElement.getAttribute("data-lx-theme")).toBe("dark");
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(LX_THEME_CHANGED_EVENT, spy);
  });

  it("applyThemeFromStorageEvent : key null (clear) réapplique", () => {
    setThemePreference("light");
    const spy = vi.fn();
    window.addEventListener(LX_THEME_CHANGED_EVENT, spy);

    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    applyThemeFromStorageEvent(
      new StorageEvent("storage", {
        key: null,
        storageArea: localStorage,
      }),
    );

    expect(document.documentElement.getAttribute("data-lx-theme")).toBe("system");
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(LX_THEME_CHANGED_EVENT, spy);
  });

  it("getEffectiveColorScheme : light forcé ou selon prefers", () => {
    setThemePreference("light");
    expect(getEffectiveColorScheme()).toBe("light");
    setThemePreference("dark");
    expect(getEffectiveColorScheme()).toBe("dark");
  });
});
