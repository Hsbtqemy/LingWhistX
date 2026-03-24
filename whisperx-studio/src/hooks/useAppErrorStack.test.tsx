/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APP_ERROR_STACK_MAX, useAppErrorStack } from "./useAppErrorStack";

describe("useAppErrorStack", () => {
  it("vide la pile avec message vide ou blanc", () => {
    const { result } = renderHook(() => useAppErrorStack());
    act(() => {
      result.current.setError("a");
      result.current.setError("b");
    });
    expect(result.current.errors).toEqual(["a", "b"]);
    act(() => {
      result.current.setError("");
    });
    expect(result.current.errors).toEqual([]);
  });

  it("clearErrors vide la pile", () => {
    const { result } = renderHook(() => useAppErrorStack());
    act(() => {
      result.current.setError("x");
      result.current.clearErrors();
    });
    expect(result.current.errors).toEqual([]);
  });

  it("tronque au max (FIFO des plus anciens)", () => {
    const { result } = renderHook(() => useAppErrorStack(3));
    act(() => {
      result.current.setError("1");
      result.current.setError("2");
      result.current.setError("3");
      result.current.setError("4");
    });
    expect(result.current.errors).toEqual(["2", "3", "4"]);
  });

  it("APP_ERROR_STACK_MAX vaut 5", () => {
    expect(APP_ERROR_STACK_MAX).toBe(5);
  });
});
