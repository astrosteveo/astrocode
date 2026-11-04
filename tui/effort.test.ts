import { expect, test } from "bun:test";
import { EFFORTS } from "../src/events";
import { effortStep } from "./effort";

test("Shift+↑ and Shift+↓ step one level, from high when none is set, as claude does", () => {
  expect(effortStep(EFFORTS, "medium", 1)).toBe("high");
  expect(effortStep(EFFORTS, "medium", -1)).toBe("low");
  expect(effortStep(EFFORTS, undefined, 1)).toBe("xhigh");
  expect(effortStep(EFFORTS, undefined, -1)).toBe("medium");
  expect(effortStep(EFFORTS, "low", -1)).toBeUndefined();
});

test("the steps stop below max, which only /effort max sets, as in claude", () => {
  expect(effortStep(EFFORTS, "xhigh", 1)).toBeUndefined();
  expect(effortStep(EFFORTS, "max", -1)).toBe("xhigh");
  expect(effortStep(["low", "medium", "high", "max"], "high", 1)).toBeUndefined();
  expect(effortStep(["low", "medium", "high", "max"], "max", -1)).toBe("high");
});
