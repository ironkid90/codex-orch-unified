# AKS Promotion Scaffold (Phase 2)

This directory is intentionally minimal for the current Container Apps-first rollout. It exists to keep promotion paths explicit and stable when we move from Azure Container Apps to AKS.

## Scope in this phase

- Define the AKS promotion boundaries.
- Keep image names and environment contracts aligned with current Container Apps deployment units:
  - `codex-orch-web`
  - `codex-orch-worker`
  - `codex-orch-foundry` (optional)
- Document the future GitOps and orchestration hand-off.

## Planned Phase 2 integrations

1. Argo CD for cluster reconciliation and GitOps promotions.
2. Argo Workflows for durable DAG-oriented orchestration.
3. KServe (or Ray/Triton path) for model-serving workloads.
4. AKS Workload Identity for secretless cloud auth.

## Suggested structure when Phase 2 starts

- `deploy/aks/helm/` for charts or chart wrappers.
- `deploy/aks/kustomize/` for environment overlays.
- `deploy/aks/argocd/` for Applications and Projects.
- `deploy/aks/workflows/` for Argo Workflow templates.

