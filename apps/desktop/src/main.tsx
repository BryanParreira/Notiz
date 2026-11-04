import "./styles/globals.css";
import "./styles/cursor.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { Provider as TinyBaseProvider, useStores } from "tinybase/ui-react";
import { createManager } from "tinytick";
import {
  Provider as TinyTickProvider,
  useCreateManager,
} from "tinytick/ui-react";

import "@notiz/ui/globals.css";
import {
  getCurrentWebviewWindowLabel,
  init as initWindowsPlugin,
} from "@notiz/plugin-windows";
import { Toaster } from "@notiz/ui/components/ui/toast";

import { QuickCaptureHotkey } from "./capture";
import { AppI18nProvider } from "./i18n/provider";
import { routeTree } from "./routeTree.gen";
import { EventListeners } from "./services/event-listeners";
import { TaskManager } from "./services/task-manager";
import { TraySync } from "./services/tray-sync";
import { RawEditorSyncBridge } from "./session/raw-editor-sync";
import { ErrorComponent, NotFoundComponent } from "./shared/control";
import { SplashScreen } from "./shared/splash-screen";
import { bootstrapThemeFromSettings } from "./shared/theme/apply";
import { AppThemeProvider } from "./shared/theme/provider";
import {
  type Store,
  STORE_ID,
  StoreComponent,
} from "./store/tinybase/store/main";
import {
  STORE_ID as SETTINGS_STORE_ID,
  type Store as SettingsStore,
  StoreComponent as SettingsStoreComponent,
} from "./store/tinybase/store/settings";

import { queryClient } from "~/shared/query-client";

const router = createRouter({
  routeTree,
  context: undefined,
  defaultErrorComponent: ErrorComponent,
  defaultNotFoundComponent: NotFoundComponent,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function App() {
  const stores = useStores();

  const store = stores[STORE_ID] as unknown as Store;
  const settingsStore = stores[SETTINGS_STORE_ID] as unknown as SettingsStore;

  if (!store || !settingsStore) {
    return <SplashScreen />;
  }

  return (
    <AppThemeProvider>
      <AppI18nProvider>
        <RouterProvider
          router={router}
          context={{
            persistedStore: store,
            internalStore: store,
          }}
        />
      </AppI18nProvider>
    </AppThemeProvider>
  );
}

function AppWithTiny() {
  const manager = useCreateManager(() => {
    return createManager().start();
  });
  const isMainWindow = getCurrentWebviewWindowLabel() === "main";

  return (
    <QueryClientProvider client={queryClient}>
      <TinyTickProvider manager={manager}>
        <TinyBaseProvider>
          <StoreComponent />
          <SettingsStoreComponent />
          <RawEditorSyncBridge />
          <App />
          {isMainWindow ? <TaskManager /> : null}
          {isMainWindow ? <EventListeners /> : null}
          {isMainWindow ? <TraySync /> : null}
          {isMainWindow ? <QuickCaptureHotkey /> : null}
          <Toaster />
        </TinyBaseProvider>
      </TinyTickProvider>
    </QueryClientProvider>
  );
}

initWindowsPlugin();

const rootElement = document.getElementById("root")!;
async function renderApp() {
  await bootstrapThemeFromSettings();
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <AppWithTiny />
    </StrictMode>,
  );
  // Static pre-mount splash (index.html) lives outside #root so it doesn't
  // trip the empty-innerHTML guard below — remove it now that the real
  // render has committed.
  document.getElementById("boot-splash")?.remove();
}

if (!rootElement.innerHTML) {
  void renderApp();
}
