/** Standalone extension front end. Shared feature modules speak to the protocol directly;
 * the website App, Layout, entry point and PWA are not loaded or embedded. */
import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ServicesProvider, type ServicesProviderProps } from "../../../web/src/api/services";
import { VaultProvider, useVault } from "../../../web/src/vault/context";
import { useVault as defaultVault, type VaultStore } from "../../../web/src/vault/store";
import { Spinner } from "../../../web/src/components/ui";
import { PublishingProvider } from "../../../web/src/features/composer/PublishingProvider";
import { PrivateMessagingProvider } from "../../../web/src/features/messages/PrivateMessagingProvider";
import { MusicDeliverySync } from "../../../web/src/features/music/MusicDeliverySync";
import { UnlockScreen } from "../../../web/src/features/onboarding/UnlockScreen";
import { AccountEffects } from "./AccountEffects";
import { ExtensionLayout } from "./ExtensionLayout";
import { Welcome } from "./Welcome";
import { FacebookSettings, FacebookDrafts } from "./FacebookSettings";
import { FeedPage } from "../../../web/src/features/feed/FeedPage";
import { ComposerPage } from "../../../web/src/features/composer/ComposerPage";
import { PostPage } from "../../../web/src/features/post/PostPage";
import { ProfilePage } from "../../../web/src/features/profile/ProfilePage";
import { GroupsPage, CollectionPage } from "../../../web/src/features/library/LibraryPages";
import { FriendsPage } from "../../../web/src/features/friends/FriendsPage";
import { MessagesPage } from "../../../web/src/features/messages/MessagesPage";
import { MusicPage } from "../../../web/src/features/music/MusicPage";
import { PeoplePage } from "../../../web/src/features/people/PeopleSearch";
import { NotificationsPage } from "../../../web/src/features/notifications/NotificationsPage";
import { WalletPage } from "../../../web/src/features/wallet/WalletPage";
import { TokensPage } from "../../../web/src/features/tokens/TokensPage";
import { SettingsPage } from "../../../web/src/features/settings/SettingsPage";
import { RecoveryPage } from "../../../web/src/features/recovery/RecoveryPage";
import { HashtagPage } from "../../../web/src/features/feed/HashtagPage";
import { AboutPage } from "../../../web/src/features/about/AboutPage";

function AccountGate({ children }: { children: ReactNode }) {
  const status=useVault(s=>s.status), location=useLocation();
  if(status==="loading") return <Spinner label="Opening your account"/>;
  if(status==="empty") return <Navigate to="/welcome" state={{from:location.pathname+location.search}} replace/>;
  if(status==="locked") return <UnlockScreen/>;
  return <>{children}</>;
}
function OwnProfile() { const account=useVault(s=>s.account); return <Navigate to={account?`/u/${account}`:"/welcome"} replace/>; }
export function ExtensionRoutes() {
  return <Routes>
    <Route path="/" element={<FeedPage/>}/>
    <Route path="/compose" element={<AccountGate><ComposerPage/><FacebookDrafts/></AccountGate>}/>
    <Route path="/post/:postId" element={<PostPage/>}/>
    <Route path="/u/:account" element={<ProfilePage/>}/>
    <Route path="/me" element={<AccountGate><OwnProfile/></AccountGate>}/>
    <Route path="/groups" element={<AccountGate><GroupsPage/></AccountGate>}/>
    <Route path="/collections/:id" element={<CollectionPage/>}/>
    <Route path="/friends" element={<AccountGate><FriendsPage/></AccountGate>}/>
    <Route path="/messages" element={<AccountGate><MessagesPage/></AccountGate>}/>
    <Route path="/notifications" element={<AccountGate><NotificationsPage/></AccountGate>}/>
    <Route path="/wallet" element={<AccountGate><WalletPage/></AccountGate>}/>
    <Route path="/tokens" element={<AccountGate><TokensPage/></AccountGate>}/>
    <Route path="/music/:id" element={<MusicPage/>}/>
    <Route path="/tags/:tag" element={<HashtagPage/>}/>
    <Route path="/people" element={<PeoplePage/>}/>
    <Route path="/settings" element={<SettingsPage/>}/>
    <Route path="/connections" element={<FacebookSettings/>}/>
    <Route path="/facebook" element={<Navigate to="/connections" replace/>}/>
    <Route path="/browser-drafts" element={<div className="page"><h1>Unfinished browser posts</h1><FacebookDrafts/></div>}/>
    <Route path="/welcome" element={<Welcome/>}/>
    <Route path="/recover" element={<RecoveryPage/>}/>
    <Route path="/about" element={<AboutPage/>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes>;
}
export interface ExtensionAppProps { vault?:VaultStore; settings?:ServicesProviderProps["store"]; services?:ServicesProviderProps["factory"] }
export function App({vault=defaultVault,settings,services}:ExtensionAppProps) {
  useEffect(()=>{if(vault.getState().status==="loading")void vault.getState().init();},[vault]);
  return <VaultProvider store={vault}><ServicesProvider {...(settings&&{store:settings})} {...(services&&{factory:services})}>
    <PublishingProvider><PrivateMessagingProvider><AccountEffects/><MusicDeliverySync/>
      <ExtensionLayout><ExtensionRoutes/></ExtensionLayout>
    </PrivateMessagingProvider></PublishingProvider>
  </ServicesProvider></VaultProvider>;
}
