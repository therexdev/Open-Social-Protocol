/** Routes and the account gate: empty vault -> onboarding, locked -> unlock screen, unlocked -> app. */
import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ServicesProvider, useServices } from "./api/services";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { ComposerPage } from "./features/composer/ComposerPage";
import { FeedPage } from "./features/feed/FeedPage";
import { FriendsPage } from "./features/friends/FriendsPage";
import { NotificationsPage } from "./features/notifications/NotificationsPage";
import { OnboardingPage } from "./features/onboarding/OnboardingPage";
import { UnlockScreen } from "./features/onboarding/UnlockScreen";
import { PostPage } from "./features/post/PostPage";
import { ProfilePage } from "./features/profile/ProfilePage";
import { RecoveryPage } from "./features/recovery/RecoveryPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { useAccount } from "./stores/account";
import { useSettings } from "./stores/settings";
import { useVault, type VaultStore } from "./vault/store";

/** Pages that need an account: onboarding when none exists, unlock when locked. */
function RequireAccount({ children }: { children: ReactNode }) {
  const status = useVault((s) => s.status);
  const location = useLocation();
  if (status === "loading") return <Spinner label="Opening your vault" />;
  if (status === "empty") return <Navigate to="/welcome" replace state={{ from: location.pathname }} />;
  if (status === "locked") return <UnlockScreen />;
  return <>{children}</>;
}

/** Pages readable without an account (public feed, posts, profiles). */
function Optional({ children }: { children: ReactNode }) {
  const status = useVault((s) => s.status);
  if (status === "loading") return <Spinner label="Opening your vault" />;
  if (status === "empty") return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

function AccountEffects() {
  const status = useVault((s) => s.status);
  const account = useVault((s) => s.account);
  const setAutoLockMs = useVault((s) => s.setAutoLockMs);
  const autoLockMinutes = useSettings((s) => s.autoLockMinutes);
  const services = useServices();
  const check = useAccount((s) => s.check);
  const reset = useAccount((s) => s.reset);
  useEffect(() => {
    setAutoLockMs(autoLockMinutes * 60_000);
  }, [autoLockMinutes, setAutoLockMs]);
  useEffect(() => {
    if (status === "unlocked" && account) void check(services, account);
    if (status === "empty") reset();
  }, [status, account, services, check, reset]);
  return null;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/welcome" element={<OnboardingPage />} />
      <Route path="/recover" element={<RecoveryPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route
        path="/"
        element={
          <Optional>
            <FeedPage />
          </Optional>
        }
      />
      <Route
        path="/post/:postId"
        element={
          <Optional>
            <PostPage />
          </Optional>
        }
      />
      <Route
        path="/u/:account"
        element={
          <Optional>
            <ProfilePage />
          </Optional>
        }
      />
      <Route
        path="/compose"
        element={
          <RequireAccount>
            <ComposerPage />
          </RequireAccount>
        }
      />
      <Route
        path="/friends"
        element={
          <RequireAccount>
            <FriendsPage />
          </RequireAccount>
        }
      />
      <Route
        path="/notifications"
        element={
          <RequireAccount>
            <NotificationsPage />
          </RequireAccount>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export interface AppProps {
  vault?: VaultStore;
}

export function App({ vault = useVault }: AppProps) {
  useEffect(() => {
    if (vault.getState().status === "loading") void vault.getState().init();
  }, [vault]);
  return (
    <ServicesProvider>
      <AccountEffects />
      <Layout>
        <AppRoutes />
      </Layout>
    </ServicesProvider>
  );
}
