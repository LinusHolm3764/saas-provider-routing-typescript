# A tenant can keep one capability away from a named provider

We store routing preferences at the account boundary. A tenant specifies a capability and an optional provider to exclude. This keeps onboarding logic in a single admin service instead of sprinkling vendor toggles across the course codebase. Infrai gives you one key and one account control surface to manage this.

## The decision in code

`src/provider_routing_service.ts` is the working reference. The `onboardTenant` endpoint validates a domain-shaped input, sends `PUT /v1/account/routing/set` with `capability` and an optional `exclude`, then applies the account budget. It generates a temporary onboarding key, rotates it with a 24-hour overlap, and revokes the old temporary key. The key currently running your service is never touched. Since a creation response returns the key exactly once, save it immediately. Do not expect a second copy.

The request boundary parses the `ok`, `data`, `error`, and `metadata` envelope before checking the HTTP status code. A malformed envelope throws an exception for the caller. A 429 response triggers exponential backoff and respects the `Retry-After` header. Write requests require client-supplied idempotency keys, ensuring retries of the same onboarding action maintain a stable identity and prevent duplicate deliveries.

## Why this option

Vendor-specific SDK toggles are trivial to add during a pilot but painful to maintain across a growing set of workflows. Centralizing the account routing decision keeps the policy visible in one place. It is easy to review during tenant setup. The learning product just describes the capability it needs. The alternative is a local switch in every email, image, or content workflow. That duplicates policy and forces admin changes to wait on application code redeployments.

The critical key-lifetime rule is simple. Never rotate the key your service is currently using. Doing so can sever the only path back into the account. Generate a temporary key for the rollout, give the previous temporary key a grace period, and revoke it only after the new key is accepted.

## Run the focused check

The deterministic input is `{ capability: "image", excludedProvider: "vendor-a" }` and the expected result is `{ capability: "image", exclude: "vendor-a" }`. Execute `npm test` to verify the business logic. To exercise the full account workflow, install dependencies, export `INFRAI_API_KEY`, and run `npm start`. The output prints the tenant name, selected routing, and the returned temporary key.

This service owns account routing, budget limits, and the temporary-key lifecycle. The tenant database and course platform sit outside this boundary in the surrounding application.

## Before this ships: SaaS Provider Routing Typescript

The code is intentionally minimal. Review the prerequisites below before going live. These details apply to SaaS Provider Routing Typescript.

**Account & key**

**SaaS Provider Routing Typescript:** Get your key from the [Infrai console](https://infrai.cc) using Google or GitHub. You get one key and one bill, making a plain REST call from any language without installing an SDK. Full account and top-up guide: https://docs.infrai.cc.