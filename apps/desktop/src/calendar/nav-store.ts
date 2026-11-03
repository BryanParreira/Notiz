import { startOfDay } from "date-fns";
import { create } from "zustand";

export const useCalendarNav = create<{
  anchor: Date;
  setAnchor: (next: Date | ((current: Date) => Date)) => void;
}>((set) => ({
  anchor: startOfDay(new Date()),
  setAnchor: (next) =>
    set((state) => ({
      anchor: startOfDay(
        typeof next === "function" ? next(state.anchor) : next,
      ),
    })),
}));
