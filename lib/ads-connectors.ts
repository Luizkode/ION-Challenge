/** Provider boundary. No credentials or OAuth grants were supplied for either provider. */
export type AdProvider = "meta" | "google";
export type AdsImportContext = {
  companyId: string;
  accountReference: string;
  from: string;
  to: string;
  timeZone: string;
  attribution: string;
};
export interface AdsConnector {
  provider: AdProvider;
  fetchObservations(context: AdsImportContext): Promise<unknown[]>;
}
export const integrationStatus = {
  meta: {
    enabled: false,
    reason:
      "Aguardando aplicativo Meta aprovado, ads_read e autorização dos ativos publicitários.",
  },
  google: {
    enabled: false,
    reason:
      "Aguardando developer token, OAuth adwords e autorização das contas Google Ads.",
  },
} as const;
export function adsConnector(provider: AdProvider): AdsConnector {
  return {
    provider,
    async fetchObservations() {
      throw new Error(integrationStatus[provider].reason);
    },
  };
}
