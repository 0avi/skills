# Target: Azure App Service and Container Apps

Two Azure PaaS targets with different models. App Service's **slot swap** is the cleanest blue-green primitive available anywhere in this skill; Container Apps' **revisions with traffic weights** give canary deployment with almost no machinery.

| | App Service | Container Apps |
| --- | ----------- | -------------- |
| Unit | An app, with **deployment slots** | An app, with **revisions** |
| Artifact | A package (jar, zip) **or** a container image | A container image only |
| Zero-downtime primitive | **Slot swap**, with warm-up | **Traffic weights** across revisions |
| Rollback | **Swap back** | Shift traffic to the previous revision |
| Best for | Blue-green with verification before cutover | Canary, and scale-to-zero workloads |

---

## App Service: slots

A slot is a full deployment of the app with its own hostname, sharing the plan. Deploy to a staging slot, verify it, then swap.

```bash
az webapp deploy -g rg -n app --slot staging --src-path target/app.jar --type jar
# verify the staging slot's own hostname here, before any user traffic
az webapp deployment slot swap -g rg -n app --slot staging --target-slot production
```

**The swap is the interesting part.** It is not a DNS change: Azure warms the staging instance, waits for it to respond, then exchanges the routing. That gives you a real pre-cutover verification window against production configuration, which nothing else here offers as cheaply.

### Sticky settings

The setting that makes or breaks slots: some app settings and connection strings can be marked **slot-specific** ("deployment slot setting"), meaning they **do not** move during a swap.

```
NOT sticky (swaps with the code):  application settings by default
Sticky (stays with the slot):      settings marked as slot settings
```

Get this wrong and the staging slot swaps into production **carrying staging's database connection string**, which is exactly as bad as it sounds. Mark every environment-distinguishing setting as slot-specific, and verify by reading the effective configuration of each slot rather than assuming.

### Warm-up

```jsonc
// applicationHost.xdt or app setting
"WEBSITE_SWAP_WARMUP_PING_PATH": "/actuator/health/readiness",
"WEBSITE_SWAP_WARMUP_PING_STATUSES": "200"
```

Without a warm-up path the swap can complete before the app is serving, which reintroduces the errors slots exist to prevent. For a JVM application with slow start this is not optional.

`WEBSITE_WARMUP_PATH` and the swap ping settings are the mechanism; set them or the swap is a guess.

## Container Apps: revisions

Every configuration or image change creates an immutable **revision**. Traffic is then split across revisions by weight:

```bash
az containerapp update -g rg -n app --image "$REG/app@$digest"
# canary: 10% to the new revision
az containerapp ingress traffic set -g rg -n app \
  --revision-weight latest=10 app--prev=90
```

This is canary deployment with no service mesh and no extra tooling, which is genuinely convenient. Requirements are the usual ones: **two revisions serve simultaneously**, so expand-only migrations and compatible message and cache formats. See [database-migrations.md](database-migrations.md).

Revision modes matter:

| Mode | Behaviour |
| ---- | --------- |
| **Single** | Each new revision replaces the previous. No traffic splitting |
| **Multiple** | Revisions coexist, traffic split by weight. **Required for canary or blue-green** |

**In single-revision mode the traffic commands do nothing useful**, which is a common surprise. Set multiple-revision mode deliberately.

Scale-to-zero is available and attractive for cost, at the cost of cold starts on the first request after idle - which for a JVM application can be seconds. Set a minimum replica count for anything latency-sensitive.

## Identity and credentials

Use **workload identity federation** from the CI platform, and **managed identity** for the app's own access to Azure resources:

```yaml
# GitHub Actions
permissions:
  id-token: write
steps:
  - uses: azure/login@<sha>
    with:
      client-id: ${{ vars.AZURE_CLIENT_ID }}
      tenant-id: ${{ vars.AZURE_TENANT_ID }}
      subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
```

From Azure DevOps, use a **workload identity federation service connection** rather than a service principal secret. Either way no long-lived credential exists to rotate or leak. See [oidc-and-secrets.md](oidc-and-secrets.md) and [azure-devops.md](azure-devops.md).

For the application, a **managed identity** removes connection-string secrets entirely: the app authenticates to the database or storage account as itself.

## Configuration

| Mechanism | Notes |
| --------- | ----- |
| App settings | Environment variables. Mark slot-specific ones as such |
| **Key Vault references** | The setting holds a reference; the value stays in Key Vault |
| Container Apps secrets | Referenced by env vars, and a secret change creates a new revision |

**Prefer Key Vault references** so the value is never in the app configuration, rotation happens in one place, and access is audited.

Note the Container Apps behaviour: changing a secret **creates a new revision**, so a secret rotation is a deployment. Plan it as one rather than being surprised.

## Version notes

- **App Service slot swap** warms the target and exchanges routing; it is not a DNS change.
- **Slot-specific settings do not swap.** This is the single most important App Service detail.
- **Container Apps needs multiple-revision mode** for traffic splitting; single mode ignores weights.
- **A Container Apps secret change creates a revision**, so it is a deployment.
- **Deploy by digest** on both, not by tag, for the usual reason. See [artifacts-and-registries.md](artifacts-and-registries.md).
- **Not verified here:** no Azure subscription available. All cited from Microsoft's documentation. Azure CLI command shapes change; verify against the current CLI.

## Gotchas

- Agent swaps slots without marking environment settings slot-specific - staging's connection string swaps into production
- Agent omits a swap warm-up path - the swap completes before the app serves, reintroducing the errors slots prevent
- Agent expects Container Apps traffic weights to work in single-revision mode - they are ignored
- Agent canaries across revisions with a breaking schema change - two revisions serve simultaneously
- Agent enables scale-to-zero for a latency-sensitive JVM app - cold starts of seconds on the first request
- Agent deploys by tag rather than digest - the running artifact is not identifiably the tested one
- Agent uses a service principal secret from Azure DevOps - workload identity federation removes it
- Agent puts a connection string in app settings when managed identity would work - a secret that need not exist
- Agent rotates a Container Apps secret without expecting a new revision - it is a deployment
- Agent verifies the staging slot by the production hostname - defeats the purpose; use the slot's own hostname
- Agent assumes a swap-back rollback restores warm state - the swapped-out instance may need warming again

## Related

- [deployment-strategies.md](deployment-strategies.md) · [rollback.md](rollback.md) · [azure-devops.md](azure-devops.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [environments-and-promotion.md](environments-and-promotion.md) · [database-migrations.md](database-migrations.md) · [containers.md](containers.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [checklist.md](checklist.md)
