/** Routes and the account gate: empty vault -> onboarding, locked -> unlock screen, unlocked -> app. */
import { useEffect, useRef, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ServicesProvider, useServices, type ServicesProviderProps } from "./api/services";
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
import { VaultProvider, useVault } from "./vault/context";
import { useVault as defaultVault, type VaultStore } from "./vault/store";

/** Pages that need an account: onboarding when none exists, unlock when locked. */
function RequireAccount({ children }: { children: ReactNode }) {
  const status = useVault((s) => s.status);
  const location = useLocation();
  if (status === "loading") return <Spinner label="Opening your vault" />;
  if (status === "empty") return <Navigate to="/welcome" replace state={{ from: location.pathname }} />;
  if (status === "locked") return <UnlockScreen />;
  return <>{children}</>;
}

/**
 * Pages readable without an account (public feed, posts, profiles). A visitor without a vault
 * still starts at onboarding, but the link they opened is kept and restored afterwards.
 */
function Optional({ children }: { children: ReactNode }) {
  const status = useVault((s) => s.status);
  const location = useLocation();
  if (status === "loading") return <Spinner label="Opening your vault" />;
  if (status === "empty") return <Navigate to="/welcome" replace state={{ from: `${location.pathname}${location.search}` }} />;
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
  const lastServices = useRef(services);
  useEffect(() => {
    // A network / endpoint change may point at a chain where the account is not registered: re-check.
    const force = lastServices.current !== services;
    lastServices.current = services;
    if (status === "unlocked" && account) void check(services, account, force);
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
  /** Test hooks: settings store and service factory (fake indexer / provider). */
  settings?: ServicesProviderProps["store"];
  services?: ServicesProviderProps["factory"];
}

export function App({ vault = defaultVault, settings, services }: AppProps) {
  useEffect(() => {
    if (vault.getState().status === "loading") void vault.getState().init();
  }, [vault]);
  return (
    <VaultProvider store={vault}>
      <ServicesProvider {...(settings && { store: settings })} {...(services && { factory: services })}>
        <AccountEffects />
        <Layout>
          <AppRoutes />
        </Layout>
      </ServicesProvider>
    </VaultProvider>
  );
}
