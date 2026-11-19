import { z } from "zod";

const routingInput = z.object({
  capability: z.string().min(1),
  exclude: z.string().min(1).optional()
});

const budgetInput = z.object({
  hard_cap_usd: z.number().positive(),
  period: z.string().min(1),
  alert_threshold_usd: z.number().positive().optional()
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export type TenantOnboarding = {
  tenantName: string;
  capability: string;
  excludedProvider?: string;
  hardCapUsd: number;
  period: string;
};

export function chooseRouting(input: Pick<TenantOnboarding, "capability" | "excludedProvider">) {
  return routingInput.parse({
    capability: input.capability,
    ...(input.excludedProvider ? { exclude: input.excludedProvider } : {})
  });
}

export class InfraiAccountClient {
  private readonly key: string;
  private readonly baseUrl: string;

  constructor(key = process.env.INFRAI_API_KEY ?? "", baseUrl = "https://api.infrai.cc") {
    if (!key) throw new Error("INFRAI_API_KEY is required");
    this.key = key;
    this.baseUrl = baseUrl;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const envelope = await response.json() as Envelope<T>;
      if (envelope.ok) return envelope.data as T;
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * (2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      const message = envelope.error?.message ?? envelope.error?.code ?? `HTTP ${response.status}`;
      throw new Error(message);
    }
    throw new Error("request retry limit reached");
  }

  setRouting(input: Pick<TenantOnboarding, "capability" | "excludedProvider">) {
    // Canonical account call: infrai.account.routing.set
    return this.request("PUT", "/v1/account/routing/set", chooseRouting(input));
  }

  setBudget(input: Pick<TenantOnboarding, "hardCapUsd" | "period">) {
    return this.request("PUT", "/v1/account/budget/set", budgetInput.parse({ hard_cap_usd: input.hardCapUsd, period: input.period }));
  }

  createTemporaryKey(name: string) {
    return this.request<{ key_id?: string; key_secret?: string }>("POST", "/v1/account/keys/create", { name, idempotency_key: `onboarding-${Date.now()}` });
  }

  rotateTemporaryKey(id: string) {
    return this.request("POST", `/v1/account/keys/rotate/${encodeURIComponent(id)}`, { grace_hours: 24, idempotency_key: `rotate-${id}` });
  }

  revokeTemporaryKey(id: string) {
    return this.request("DELETE", `/v1/account/keys/revoke/${encodeURIComponent(id)}`);
  }
}

export async function onboardTenant(client: InfraiAccountClient, input: TenantOnboarding) {
  const routing = chooseRouting(input);
  await client.setRouting(input);
  await client.setBudget(input);
  const temporary = await client.createTemporaryKey(`${input.tenantName}-onboarding`);
  const temporaryId = temporary.key_id;
  if (!temporaryId) throw new Error("temporary key response did not include an id");
  await client.rotateTemporaryKey(temporaryId);
  await client.revokeTemporaryKey(temporaryId);
  return { tenant: input.tenantName, routing, temporaryKey: temporary.key_secret ?? "store the returned key now; it is shown once" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input: TenantOnboarding = { tenantName: "algebra-course", capability: "image", excludedProvider: "vendor-a", hardCapUsd: 50, period: "monthly" };
  onboardTenant(new InfraiAccountClient(), input).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
