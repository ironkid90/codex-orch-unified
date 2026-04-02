# Azure Infrastructure (Container Apps First)

This directory defines the West Europe baseline infrastructure for the Container Apps-first rollout using `azd + Bicep`.

## Files

- `main.bicep`: resource topology (ACR, Container Apps, Postgres, Redis, Storage, Key Vault, Log Analytics, App Insights).
- `main.parameters.json`: `azd`-substituted parameter map fed by environment values.

## Provisioning path

The intended provisioning path is:

1. Configure `azure.yaml` at repo root.
2. Set environment values in `azd env` (done in the provisioning GitHub workflow).
3. Run `azd provision --no-prompt`.

## Required `azd env` values

- `AZURE_ENV_NAME`
- `AZURE_LOCATION`
- `AZURE_ACR_NAME`
- `AZURE_CONTAINERAPPS_ENV_NAME`
- `AZURE_WEB_APP_NAME`
- `AZURE_WORKER_APP_NAME`
- `AZURE_FOUNDRY_APP_NAME`
- `AZURE_DEPLOY_FOUNDRY`
- `AZURE_APPINSIGHTS_NAME`
- `AZURE_LOG_ANALYTICS_NAME`
- `AZURE_STORAGE_ACCOUNT_NAME`
- `AZURE_KEY_VAULT_NAME`
- `AZURE_REDIS_NAME`
- `AZURE_POSTGRES_SERVER_NAME`
- `AZURE_POSTGRES_DB_NAME`
- `AZURE_POSTGRES_ADMIN_LOGIN`
- `AZURE_POSTGRES_ADMIN_PASSWORD`

## Runtime contract mapping

Provisioning names above are for resource creation. The deployed Container Apps also receive runtime variables that the app reads directly:

- `SWARM_PERSISTENCE_BACKEND=azure`
- `SWARM_EXECUTION_ROLE`
- `SWARM_EXECUTION_TRANSPORT=redis`
- `APP_ROLE`
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
