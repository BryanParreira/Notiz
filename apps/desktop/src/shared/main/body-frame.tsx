import {
  MainSessionStatusBannerHost,
  SessionStatusBannerProvider,
} from "./session-status-banner";

export function MainShellBodyFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionStatusBannerProvider>
      {children}
      <MainSessionStatusBannerHost />
    </SessionStatusBannerProvider>
  );
}
