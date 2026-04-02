import { z } from "zod";

import type { RunMode, SwarmFeatures } from "./types";

export type SwarmPersistenceBackend = "file" | "azure";
export type SwarmExecutionRole = "all" | "web" | "worker";
export type SwarmExecutionTransport = "local" | "redis";

export interface QueuedSwarmStartRequest {
  requestedAt: string;
  workspace: string;
  maxRounds?: number;
  mode?: RunMode;
  features?: Partial<SwarmFeatures>;
  prompt?: string;
  source?: string;
}

export interface AzureRuntimeContract {
  backend: SwarmPersistenceBackend;
  enabled: boolean;
  executionRole: SwarmExecutionRole;
  executionTransport: SwarmExecutionTransport;
  location: string;
  environmentName?: string;
  containerAppsEnvironment?: string;
  webAppName?: string;
  workerAppName?: string;
  foundryAppName?: string;
  keyVaultUrl?: string;
  postgresUrl?: string;
  redisUrl?: string;
  storageAccount?: string;
  storageContainer: string;
  storageConnectionString?: string;
  applicationInsightsConnectionString?: string;
  otelExporterOtlpEndpoint?: string;
  azureOpenAiEndpoint?: string;
  azureOpenAiDeployment?: string;
  azureOpenAiApiKey?: string;
  foundryProjectEndpoint?: string;
  foundryModelDeploymentName?: string;
  startQueueKey: string;
}

const ExecutionRoleSchema = z.enum(["all", "web", "worker"]);
const ExecutionTransportSchema = z.enum(["local", "redis"]);

function clean(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeBackend(value?: string): SwarmPersistenceBackend {
  return clean(value)?.toLowerCase() === "azure" ? "azure" : "file";
}

function buildContract(): AzureRuntimeContract {
  const backend = normalizeBackend(process.env.SWARM_PERSISTENCE_BACKEND);
  const location = clean(process.env.AZURE_LOCATION) || "westeurope";
  const executionRole = ExecutionRoleSchema.parse(
    clean(process.env.SWARM_EXECUTION_ROLE)?.toLowerCase() || "all",
  );
  const executionTransport = ExecutionTransportSchema.parse(
    clean(process.env.SWARM_EXECUTION_TRANSPORT)?.toLowerCase() || "local",
  );
  const postgresUrl = clean(process.env.AZURE_POSTGRES_URL);
  const redisUrl = clean(process.env.AZURE_REDIS_URL);
  const storageAccount = clean(process.env.AZURE_STORAGE_ACCOUNT);
  const storageConnectionString = clean(process.env.AZURE_STORAGE_CONNECTION_STRING);
  const enabled = backend === "azure" && Boolean(postgresUrl);

  return {
    backend,
    enabled,
    executionRole,
    executionTransport,
    location,
    environmentName: clean(process.env.AZURE_ENV_NAME),
    containerAppsEnvironment: clean(process.env.AZURE_CONTAINERAPPS_ENVIRONMENT),
    webAppName: clean(process.env.AZURE_CONTAINERAPPS_WEB_APP_NAME),
    workerAppName: clean(process.env.AZURE_CONTAINERAPPS_WORKER_APP_NAME),
    foundryAppName: clean(process.env.AZURE_CONTAINERAPPS_FOUNDRY_APP_NAME),
    keyVaultUrl: clean(process.env.AZURE_KEY_VAULT_URL),
    postgresUrl,
    redisUrl,
    storageAccount,
    storageContainer: clean(process.env.AZURE_STORAGE_CONTAINER) || "swarm-artifacts",
    storageConnectionString,
    applicationInsightsConnectionString: clean(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING),
    otelExporterOtlpEndpoint: clean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
    azureOpenAiEndpoint: clean(process.env.AZURE_OPENAI_ENDPOINT),
    azureOpenAiDeployment: clean(process.env.AZURE_OPENAI_DEPLOYMENT),
    azureOpenAiApiKey: clean(process.env.AZURE_OPENAI_API_KEY),
    foundryProjectEndpoint: clean(process.env.FOUNDRY_PROJECT_ENDPOINT),
    foundryModelDeploymentName: clean(process.env.FOUNDRY_MODEL_DEPLOYMENT_NAME),
    startQueueKey: clean(process.env.SWARM_START_QUEUE_KEY) || "swarm:start:requests",
  };
}

export function getAzureRuntimeContract(): AzureRuntimeContract {
  return buildContract();
}

export function isAzurePersistenceEnabled(): boolean {
  return getAzureRuntimeContract().enabled;
}

export function supportsAzureBlobArtifacts(): boolean {
  const contract = getAzureRuntimeContract();
  return contract.enabled && Boolean(contract.storageConnectionString || contract.storageAccount);
}

export function shouldQueueStartRequests(): boolean {
  const contract = getAzureRuntimeContract();
  return contract.enabled && contract.executionTransport === "redis" && contract.executionRole === "web";
}

export function usesRemoteControlPlane(): boolean {
  const contract = getAzureRuntimeContract();
  return contract.enabled && contract.executionRole === "web";
}

export function isWorkerExecutionRole(): boolean {
  const role = getAzureRuntimeContract().executionRole;
  return role === "worker" || role === "all";
}

