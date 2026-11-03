import { useCallback } from "react";

import { useDesktopTabLifecycle } from "~/shared/desktop-tab-lifecycle";
import * as main from "~/store/tinybase/store/main";
import { useTabs } from "~/store/zustand/tabs";

export function useClassicMainLifecycle() {
  const openNew = useTabs((state) => state.openNew);
  const store = main.UI.useStore(main.STORE_ID);
  const indexes = main.UI.useIndexes(main.STORE_ID);

  const openDefaultEmptyTab = useCallback(() => {
    openNew({ type: "empty" });
  }, [openNew]);

  useDesktopTabLifecycle({
    store,
    indexes,
    onEmpty: openDefaultEmptyTab,
    onZeroTabs: openDefaultEmptyTab,
  });
}

export function ClassicMainServices() {
  return null;
}
