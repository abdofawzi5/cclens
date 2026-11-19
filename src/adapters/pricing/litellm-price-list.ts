import { z } from 'zod';
import type { ModelPrice } from '../../core/domain/agent.js';
import { IntegrationError } from '../../core/errors.js';
import type { PriceList, PriceTable } from '../../core/ports/agents.js';
import type { Cache, HttpClient } from '../../core/ports/infrastructure.js';

/** The model price list ccusage uses. Downloading it sends nothing about the user. */
export const LITELLM_PRICES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const CACHE_KEY = 'litellm-prices-v1';
const DAY_SECONDS = 86_400;

const entry = z.looseObject({
  input_cost_per_token: z.number().optional(),
  output_cost_per_token: z.number().optional(),
  cache_creation_input_token_cost: z.number().optional(),
  cache_read_input_token_cost: z.number().optional(),
});

type Prices = Record<string, ModelPrice>;

/** Keeps only Claude models with input and output prices, so the cached copy stays small. */
export function parsePriceList(raw: unknown): Prices {
  const prices: Prices = {};
  if (!raw || typeof raw !== 'object') return prices;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.includes('claude')) continue;
    const e = entry.safeParse(value);
    if (!e.success) continue;
    const { input_cost_per_token: input, output_cost_per_token: output } = e.data;
    if (input === undefined || output === undefined) continue;
    prices[key] = {
      input,
      output,
      cacheCreation: e.data.cache_creation_input_token_cost ?? input * 1.25,
      cacheRead: e.data.cache_read_input_token_cost ?? input * 0.1,
    };
  }
  return prices;
}

/** Finds a model the way ccusage does: exact name, provider-prefixed, then without a date suffix. */
export function lookupPrice(prices: Prices, model: string): ModelPrice | undefined {
  const bare = model.replace(/-\d{8}$/, '');
  for (const key of [model, `anthropic/${model}`, bare, `anthropic/${bare}`]) {
    const hit = prices[key];
    if (hit) return hit;
  }
  return undefined;
}

/** LiteLLM prices over HTTPS, cached for a day in the cclens cache folder. */
export class LiteLlmPriceList implements PriceList {
  private loaded?: Promise<PriceTable>;

  constructor(
    private readonly http: HttpClient,
    private readonly cache: Cache,
    private readonly url: string = LITELLM_PRICES_URL,
    private readonly timeoutMs = 10_000,
  ) {}

  load(): Promise<PriceTable> {
    this.loaded ??= this.fetch().then((prices) => ({
      price: (model: string) => lookupPrice(prices, model),
    }));
    return this.loaded;
  }

  private async fetch(): Promise<Prices> {
    const cached = await this.cache.get<Prices>(CACHE_KEY);
    if (cached) return cached;
    const res = await this.http.getJson(this.url, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status !== 200) {
      throw new IntegrationError('prices', `Price list returned HTTP ${res.status}`);
    }
    const prices = parsePriceList(res.json);
    if (Object.keys(prices).length === 0) {
      throw new IntegrationError('prices', 'Price list had no Claude models');
    }
    await this.cache.set(CACHE_KEY, prices, DAY_SECONDS);
    return prices;
  }
}
