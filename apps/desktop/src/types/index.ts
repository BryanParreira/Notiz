import { type Store as InternalStore } from "~/store/tinybase/store/main";
import { type Store as MainStore } from "~/store/tinybase/store/main";

export type Context = {
  persistedStore: MainStore;
  internalStore: InternalStore;
};
