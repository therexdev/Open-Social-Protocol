// Content script entry (registered at runtime with chrome.scripting.registerContentScripts,
// isolated world, classic script). All logic lives in facebookAdapter.ts so it can be tested.
import { startFacebookAdapter } from "./facebookAdapter";

startFacebookAdapter();
