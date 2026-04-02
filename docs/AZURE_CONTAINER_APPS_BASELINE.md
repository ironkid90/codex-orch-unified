# Azure West Europe Baseline (Container Apps First)

This document defines the Azure baseline for `codex-orch-unified` using a Container Apps-first rollout with an AKS promotion path.

## What was added

- `azure.yaml` for `azd` bootstrap.
- `infra/azure/main.bicep` for declarative infrastructure.
- `infra/azure/main.parameters.json` for `azd` environment substitution.
- `infra/azure/README.md` with required env values.
- `.github/workflows/provision-azure-west-europe.yml` for guarded manual provisioning using GitHub OIDC.
- `.github/workflows/deploy-azure-west-europe.yml` for push-triggered image build + Container Apps revision deployment.
- `deploy/docker/Dockerfile.foundry` for optional Foundry image path.
- `deploy/aks/README.md` for Phase-2 AKS promotion scaffolding.

## Provisioned baseline resources (West Europe)

- Azure Container Registry (ACR)
- Container Apps managed environment
- Web Container App
- Worker Container App
- Optional Foundry Container App
- PostgreSQL Flexible Server + database
- Azure Cache for Redis
- Storage Account + artifacts container
- Key Vault
- Log Analytics + Application Insights

## GitHub OIDC secrets required

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

## Infra naming/config secrets required

- `AZURE_ENV_NAME`
- `AZURE_RESOURCE_GROUP`
- `AZURE_ACR_NAME`
- `AZURE_CONTAINERAPPS_ENV_NAME`
- `AZURE_WEB_APP_NAME`
- `AZURE_WORKER_APP_NAME`
- `AZURE_FOUNDRY_APP_NAME`
- `AZURE_DEPLOY_FOUNDRY` (`true` or `false`)
- `AZURE_APPINSIGHTS_NAME`
- `AZURE_LOG_ANALYTICS_NAME`
- `AZURE_STORAGE_ACCOUNT_NAME`
- `AZURE_KEY_VAULT_NAME`
- `AZURE_REDIS_NAME`
- `AZURE_POSTGRES_SERVER_NAME`
- `AZURE_POSTGRES_DB_NAME`
- `AZURE_POSTGRES_ADMIN_LOGIN`
- `AZURE_POSTGRES_ADMIN_PASSWORD`

## Workflow behavior

## Runtime environment contract

The Container Apps baseline expects these runtime variables on the deployed apps:

- `SWARM_PERSISTENCE_BACKEND=azure`
- `SWARM_EXECUTION_ROLE=web|worker|all`
- `SWARM_EXECUTION_TRANSPORT=redis`
- `APP_ROLE=web|worker`
- `AZURE_LOCATION`
- `AZURE_CONTAINERAPPS_ENVIRONMENT`
- `AZURE_CONTAINERAPPS_WEB_APP_NAME`
- `AZURE_CONTAINERAPPS_WORKER_APP_NAME`
- `AZURE_CONTAINERAPPS_FOUNDRY_APP_NAME`
- `AZURE_KEY_VAULT_URL`
- `AZURE_POSTGRES_URL`
- `AZURE_REDIS_URL`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER`
- `APPLICATIONINSIGHTS_CONNECTION_STRING`
- Optional Azure OpenAI / Foundry values:
  - `AZURE_OPENAI_ENDPOINT`
  - `AZURE_OPENAI_DEPLOYMENT`
  - `AZURE_OPENAI_API_KEY`
  - `FOUNDRY_PROJECT_ENDPOINT`
  - `FOUNDRY_MODEL_DEPLOYMENT_NAME`

### Provision workflow

- Trigger: manual (`workflow_dispatch`) only.
- Guard: requires `apply=true`.
- Guard: runs in `azure-prod` GitHub Environment (use reviewer approvals there for production guardrails).
- Auth: GitHub OIDC with `azure/login@v2`.
- Engine: `azd provision --no-prompt`.

### Deploy workflow

- Trigger: each push to `main` and manual dispatch.
- Auth: GitHub OIDC with `azure/login@v2`.
- Image push: ACR login through Azure identity (`az acr login`) without static ACR username/password.
- Deploy: updates web/worker (and optional foundry) Container Apps to new image tags based on `github.sha`.
- Smoke checks:
  - active web revision fetched
  - endpoint check (`/api/health` fallback to `/`)
  - web logs tail

## Manual usage

1. Run `Provision Azure Baseline (West Europe)` with `apply=true`.
2. Push to `main` to trigger `Deploy Azure Container Apps (West Europe)`.
3. Validate:
   - active revision changed
   - web endpoint responds
   - logs show startup

## Notes for Phase 2 (AKS)

- Keep image names and env contract stable between Container Apps and AKS.
- Move GitOps/workflow/model-serving concerns to AKS phase:
  - Argo CD
  - Argo Workflows
  - KServe or Ray/Triton lane
