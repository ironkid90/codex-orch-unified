targetScope = 'resourceGroup'

@description('Short environment name used for tagging and naming.')
param environmentName string = 'prod'

@description('Azure region for all resources.')
param location string = 'westeurope'

@description('Tags applied to all resources.')
param tags object = {}

@description('Container registry name (globally unique).')
param acrName string

@description('Container Apps managed environment name.')
param containerAppsEnvironmentName string

@description('Container App name for the web dashboard/API.')
param webAppName string

@description('Container App name for the swarm worker process.')
param workerAppName string

@description('Container App name for optional Foundry sidecar.')
param foundryAppName string = 'codex-orch-foundry'

@description('Whether to provision the optional Foundry Container App.')
param deployFoundry bool = false

@description('Web container image reference.')
param webImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Worker container image reference.')
param workerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Foundry container image reference.')
param foundryImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Web app ingress port.')
param webTargetPort int = 3017

@description('Application Insights component name.')
param appInsightsName string

@description('Log Analytics workspace name.')
param logAnalyticsWorkspaceName string

@description('Storage account name for artifacts/checkpoints.')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Blob container name for runtime artifacts and offloads.')
param storageContainerName string = 'swarm-artifacts'

@description('Azure Key Vault name.')
param keyVaultName string

@description('Redis cache name.')
param redisName string

@description('PostgreSQL flexible server name.')
param postgresServerName string

@description('PostgreSQL database name for runtime metadata.')
param postgresDatabaseName string = 'codex_orch'

@description('PostgreSQL admin login.')
param postgresAdminLogin string = 'codexadmin'

@secure()
@description('PostgreSQL admin password.')
param postgresAdminPassword string

@description('Container app CPU allocation for web.')
param webCpu string = '0.5'

@description('Container app memory allocation for web.')
param webMemory string = '1Gi'

@description('Container app CPU allocation for worker.')
param workerCpu string = '0.5'

@description('Container app memory allocation for worker.')
param workerMemory string = '1Gi'

@description('Container app CPU allocation for foundry.')
param foundryCpu string = '0.5'

@description('Container app memory allocation for foundry.')
param foundryMemory string = '1Gi'

var commonTags = union(tags, {
  environment: environmentName
  stack: 'codex-orchestrator'
  managedBy: 'azd'
})

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  tags: commonTags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: commonTags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: commonTags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  tags: commonTags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource artifactsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  name: '${storage.name}/default/${storageContainerName}'
  properties: {
    publicAccess: 'None'
  }
}

resource redis 'Microsoft.Cache/Redis@2023-08-01' = {
  name: redisName
  location: location
  tags: commonTags
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisConfiguration: {}
  }
  sku: {
    name: 'Basic'
    family: 'C'
    capacity: 0
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: commonTags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enabledForTemplateDeployment: true
    publicNetworkAccess: 'Enabled'
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: postgresServerName
  location: location
  tags: commonTags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    version: '16'
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  name: '${postgres.name}/${postgresDatabaseName}'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  name: '${postgres.name}/allow-azure-services'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

var logAnalyticsSharedKey = listKeys(logAnalytics.id, logAnalytics.apiVersion).primarySharedKey
var storageKey = listKeys(storage.id, storage.apiVersion).keys[0].value
var redisPrimaryKey = listKeys(redis.id, redis.apiVersion).primaryKey
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storageKey};EndpointSuffix=${environment().suffixes.storage}'
var redisHost = '${redis.name}.redis.cache.windows.net'
var redisConnectionString = '${redisHost}:6380,password=${redisPrimaryKey},ssl=True,abortConnect=False'
var postgresHost = '${postgres.name}.postgres.database.azure.com'
var postgresConnectionString = 'Host=${postgresHost};Port=5432;Database=${postgresDatabaseName};Username=${postgresAdminLogin};Password=${postgresAdminPassword};Ssl Mode=Require;Trust Server Certificate=true'

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppsEnvironmentName
  location: location
  tags: commonTags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalyticsSharedKey
      }
    }
  }
}

resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: webAppName
  location: location
  tags: commonTags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: {
        external: true
        targetPort: webTargetPort
        transport: 'Auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
      secrets: [
        {
          name: 'postgres-conn'
          value: postgresConnectionString
        }
        {
          name: 'redis-conn'
          value: redisConnectionString
        }
        {
          name: 'storage-conn'
          value: storageConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: {
            cpu: json(webCpu)
            memory: webMemory
          }
          env: [
            {
              name: 'AZURE_LOCATION'
              value: location
            }
            {
              name: 'SWARM_PERSISTENCE_BACKEND'
              value: 'azure'
            }
            {
              name: 'APP_ROLE'
              value: 'web'
            }
            {
              name: 'SWARM_EXECUTION_ROLE'
              value: 'web'
            }
            {
              name: 'SWARM_EXECUTION_TRANSPORT'
              value: 'redis'
            }
            {
              name: 'AZURE_CONTAINERAPPS_ENVIRONMENT'
              value: containerAppsEnvironmentName
            }
            {
              name: 'AZURE_CONTAINERAPPS_WEB_APP_NAME'
              value: webAppName
            }
            {
              name: 'AZURE_CONTAINERAPPS_WORKER_APP_NAME'
              value: workerAppName
            }
            {
              name: 'AZURE_CONTAINERAPPS_FOUNDRY_APP_NAME'
              value: foundryAppName
            }
            {
              name: 'AZURE_KEY_VAULT_URL'
              value: keyVault.properties.vaultUri
            }
            {
              name: 'AZURE_POSTGRES_URL'
              secretRef: 'postgres-conn'
            }
            {
              name: 'AZURE_REDIS_URL'
              secretRef: 'redis-conn'
            }
            {
              name: 'AZURE_STORAGE_CONNECTION_STRING'
              secretRef: 'storage-conn'
            }
            {
              name: 'AZURE_STORAGE_CONTAINER'
              value: storageContainerName
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsights.properties.ConnectionString
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 4
      }
    }
  }
}

resource workerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: workerAppName
  location: location
  tags: commonTags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Multiple'
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
      secrets: [
        {
          name: 'postgres-conn'
          value: postgresConnectionString
        }
        {
          name: 'redis-conn'
          value: redisConnectionString
        }
        {
          name: 'storage-conn'
          value: storageConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: workerImage
          resources: {
            cpu: json(workerCpu)
            memory: workerMemory
          }
          env: [
            {
              name: 'AZURE_LOCATION'
              value: location
            }
            {
              name: 'SWARM_PERSISTENCE_BACKEND'
              value: 'azure'
            }
            {
              name: 'APP_ROLE'
              value: 'worker'
            }
            {
              name: 'SWARM_EXECUTION_ROLE'
              value: 'worker'
            }
            {
              name: 'SWARM_EXECUTION_TRANSPORT'
              value: 'redis'
            }
            {
              name: 'AZURE_CONTAINERAPPS_ENVIRONMENT'
              value: containerAppsEnvironmentName
            }
            {
              name: 'AZURE_CONTAINERAPPS_WEB_APP_NAME'
              value: webAppName
            }
            {
              name: 'AZURE_CONTAINERAPPS_WORKER_APP_NAME'
              value: workerAppName
            }
            {
              name: 'AZURE_CONTAINERAPPS_FOUNDRY_APP_NAME'
              value: foundryAppName
            }
            {
              name: 'AZURE_KEY_VAULT_URL'
              value: keyVault.properties.vaultUri
            }
            {
              name: 'AZURE_POSTGRES_URL'
              secretRef: 'postgres-conn'
            }
            {
              name: 'AZURE_REDIS_URL'
              secretRef: 'redis-conn'
            }
            {
              name: 'AZURE_STORAGE_CONNECTION_STRING'
              secretRef: 'storage-conn'
            }
            {
              name: 'AZURE_STORAGE_CONTAINER'
              value: storageContainerName
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsights.properties.ConnectionString
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 4
      }
    }
  }
}

resource foundryApp 'Microsoft.App/containerApps@2024-03-01' = if (deployFoundry) {
  name: foundryAppName
  location: location
  tags: commonTags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: {
        external: false
        targetPort: 8081
        transport: 'Auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
      secrets: [
        {
          name: 'postgres-conn'
          value: postgresConnectionString
        }
        {
          name: 'redis-conn'
          value: redisConnectionString
        }
        {
          name: 'storage-conn'
          value: storageConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'foundry'
          image: foundryImage
          resources: {
            cpu: json(foundryCpu)
            memory: foundryMemory
          }
          env: [
            {
              name: 'AZURE_LOCATION'
              value: location
            }
            {
              name: 'SWARM_PERSISTENCE_BACKEND'
              value: 'azure'
            }
            {
              name: 'APP_ROLE'
              value: 'web'
            }
            {
              name: 'SWARM_EXECUTION_ROLE'
              value: 'all'
            }
            {
              name: 'AZURE_CONTAINERAPPS_ENVIRONMENT'
              value: containerAppsEnvironmentName
            }
            {
              name: 'AZURE_CONTAINERAPPS_WEB_APP_NAME'
              value: webAppName
            }
            {
              name: 'AZURE_CONTAINERAPPS_WORKER_APP_NAME'
              value: workerAppName
            }
            {
              name: 'AZURE_CONTAINERAPPS_FOUNDRY_APP_NAME'
              value: foundryAppName
            }
            {
              name: 'AZURE_KEY_VAULT_URL'
              value: keyVault.properties.vaultUri
            }
            {
              name: 'AZURE_POSTGRES_URL'
              secretRef: 'postgres-conn'
            }
            {
              name: 'AZURE_REDIS_URL'
              secretRef: 'redis-conn'
            }
            {
              name: 'AZURE_STORAGE_CONNECTION_STRING'
              secretRef: 'storage-conn'
            }
            {
              name: 'AZURE_STORAGE_CONTAINER'
              value: storageContainerName
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsights.properties.ConnectionString
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 2
      }
    }
  }
}

resource webAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, webApp.name, 'acrpull')
  scope: acr
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalType: 'ServicePrincipal'
  }
}

resource workerAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, workerApp.name, 'acrpull')
  scope: acr
  properties: {
    principalId: workerApp.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalType: 'ServicePrincipal'
  }
}

resource foundryAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployFoundry) {
  name: guid(acr.id, foundryApp.name, 'acrpull')
  scope: acr
  properties: {
    principalId: foundryApp.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalType: 'ServicePrincipal'
  }
}

output locationOut string = location
output acrLoginServer string = acr.properties.loginServer
output webAppNameOut string = webApp.name
output workerAppNameOut string = workerApp.name
output foundryAppNameOut string = deployFoundry ? foundryApp.name : ''
output webFqdn string = webApp.properties.configuration.ingress.fqdn
output keyVaultUri string = keyVault.properties.vaultUri
output storageAccountNameOut string = storage.name
output postgresHost string = postgresHost
output redisHost string = redisHost
