export const ATTRIBUTION_LABEL = "Join Me On Open Social:";
export function attributionText(url: string): string {
  return /^https:\/\/opensocial\.online\/u\/[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(url) ? `${ATTRIBUTION_LABEL} ${url}` : "";
}
