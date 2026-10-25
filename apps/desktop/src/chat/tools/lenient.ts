import { z } from "zod";

// Small models send numbers and booleans as text ("10", "true"). Read what they
// meant instead of failing the whole tool call.
const toNumber = (value: unknown) => {
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return value;
};

const toBoolean = (value: unknown) => {
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return value;
};

export const lenientInt = (min: number, max: number) =>
  z.preprocess(toNumber, z.number().int().min(min).max(max).optional());

export const lenientBoolean = () =>
  z.preprocess(toBoolean, z.boolean().optional());
