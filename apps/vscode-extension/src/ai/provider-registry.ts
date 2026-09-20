import type { AiProvider } from "./types.js";

export class AiProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();

  public constructor(providers: AiProvider[]) {
    for (const provider of providers) {
      this.providers.set(provider.id, provider);
    }
  }

  public get(id: string): AiProvider | undefined {
    return this.providers.get(id);
  }

  public list(): AiProvider[] {
    return [...this.providers.values()];
  }

  public async firstAvailable(): Promise<AiProvider | undefined> {
    for (const provider of this.providers.values()) {
      if (await provider.isAvailable()) {
        return provider;
      }
    }
    return undefined;
  }
}
