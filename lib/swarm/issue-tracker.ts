export interface TrackerIssueBlocker {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

export interface TrackerIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branchName: string | null;
  url: string | null;
  labels: string[];
  blockedBy: TrackerIssueBlocker[];
  createdAt: string | null;
  updatedAt: string | null;
  assignee: string | null;
}

export interface TrackerAdapterConfig {
  kind: "linear" | "github";
  apiKey?: string;
  endpoint?: string;
  projectSlug?: string;
  repository?: string;
  activeStates?: string[];
  terminalStates?: string[];
}

export interface IssueTrackerAdapter {
  fetchCandidateIssues(): Promise<TrackerIssue[]>;
  fetchIssuesByStates(states: string[]): Promise<TrackerIssue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<Map<string, string>>;
  createComment(issueId: string, body: string): Promise<void>;
  updateIssueState(issueId: string, stateName: string): Promise<void>;
}

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  branchName?: string | null;
  url?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  state?: { name?: string | null } | null;
  labels?: { nodes?: Array<{ name?: string | null }> | null } | null;
  assignee?: { name?: string | null } | null;
  relations?: {
    nodes?: Array<{
      relatedIssue?: {
        id?: string | null;
        identifier?: string | null;
        state?: { name?: string | null } | null;
      } | null;
    }> | null;
  } | null;
}

interface LinearIssuesResponse {
  data?: {
    issues?: {
      nodes?: LinearIssueNode[] | null;
    } | null;
  } | null;
  errors?: Array<{ message?: string | null }> | null;
}

interface LinearIssueStatesResponse {
  data?: {
    issues?: {
      nodes?: Array<{
        id?: string | null;
        state?: { name?: string | null } | null;
      }> | null;
    } | null;
  } | null;
  errors?: Array<{ message?: string | null }> | null;
}

interface LinearMutationResponse {
  errors?: Array<{ message?: string | null }> | null;
}

function assertConfigValue(value: string | undefined, label: string): string {
  if (!value?.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function buildLinearFilter(projectSlug: string | undefined, states: string[]): string {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const stateFilters = states.map((state) => `{ name: { eq: "${escape(state)}" } }`).join(", ");
  const filters = [`state: { or: [${stateFilters}] }`];
  if (projectSlug?.trim()) {
    filters.push(`team: { key: { eq: "${escape(projectSlug)}" } }`);
  }
  return filters.join(" ");
}

function normalizeLinearIssue(node: LinearIssueNode): TrackerIssue {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description ?? null,
    priority: node.priority ?? null,
    state: node.state?.name ?? "unknown",
    branchName: node.branchName ?? null,
    url: node.url ?? null,
    labels: (node.labels?.nodes ?? [])
      .map((label) => label.name ?? "")
      .filter((label): label is string => Boolean(label)),
    blockedBy: (node.relations?.nodes ?? [])
      .map((relation) => relation.relatedIssue)
      .filter((issue): issue is NonNullable<typeof issue> => Boolean(issue))
      .map((issue) => ({
        id: issue.id ?? null,
        identifier: issue.identifier ?? null,
        state: issue.state?.name ?? null,
      })),
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
    assignee: node.assignee?.name ?? null,
  };
}

export class LinearTrackerAdapter implements IssueTrackerAdapter {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly projectSlug?: string;
  private readonly activeStates: string[];

  constructor(config: TrackerAdapterConfig) {
    this.endpoint = config.endpoint ?? LINEAR_GRAPHQL_ENDPOINT;
    this.apiKey = assertConfigValue(config.apiKey, "Linear tracker apiKey");
    this.projectSlug = config.projectSlug;
    this.activeStates = config.activeStates ?? ["Todo", "In Progress", "In Review"];
  }

  private async request<TResponse>(query: string, variables?: Record<string, unknown>): Promise<TResponse> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: this.apiKey,
      },
      body: JSON.stringify({
        query,
        variables: variables ?? {},
      }),
    });

    if (!response.ok) {
      throw new Error(`Linear request failed with ${response.status} ${response.statusText}.`);
    }

    return (await response.json()) as TResponse;
  }

  async fetchCandidateIssues(): Promise<TrackerIssue[]> {
    return this.fetchIssuesByStates(this.activeStates);
  }

  async fetchIssuesByStates(states: string[]): Promise<TrackerIssue[]> {
    if (!states.length) {
      return [];
    }

    const filter = buildLinearFilter(this.projectSlug, states);
    const query = `
      query FetchIssues {
        issues(first: 100, filter: { ${filter} }) {
          nodes {
            id
            identifier
            title
            description
            priority
            branchName
            url
            createdAt
            updatedAt
            state { name }
            assignee { name }
            labels { nodes { name } }
            relations(filter: { type: { eq: "blocks" } }) {
              nodes {
                relatedIssue {
                  id
                  identifier
                  state { name }
                }
              }
            }
          }
        }
      }
    `;

    const payload = await this.request<LinearIssuesResponse>(query);
    if (payload.errors?.length) {
      const message = payload.errors.map((error) => error.message ?? "unknown Linear error").join("; ");
      throw new Error(`Linear issues query failed: ${message}`);
    }

    return (payload.data?.issues?.nodes ?? []).map(normalizeLinearIssue);
  }

  async fetchIssueStatesByIds(issueIds: string[]): Promise<Map<string, string>> {
    const normalizedIssueIds = [...new Set(issueIds.filter((issueId) => issueId.trim()))];
    if (!normalizedIssueIds.length) {
      return new Map();
    }

    const query = `
      query FetchIssueStates($ids: [String!]!) {
        issues(filter: { id: { in: $ids } }, first: 100) {
          nodes {
            id
            state { name }
          }
        }
      }
    `;

    const payload = await this.request<LinearIssueStatesResponse>(query, { ids: normalizedIssueIds });
    if (payload.errors?.length) {
      const message = payload.errors.map((error) => error.message ?? "unknown Linear error").join("; ");
      throw new Error(`Linear state query failed: ${message}`);
    }

    const states = new Map<string, string>();
    for (const issue of payload.data?.issues?.nodes ?? []) {
      if (issue.id && issue.state?.name) {
        states.set(issue.id, issue.state.name);
      }
    }
    return states;
  }

  async createComment(issueId: string, body: string): Promise<void> {
    const query = `
      mutation CreateComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
        }
      }
    `;
    const payload = await this.request<LinearMutationResponse>(query, { issueId, body });
    if (payload.errors?.length) {
      const message = payload.errors.map((error) => error.message ?? "unknown Linear error").join("; ");
      throw new Error(`Linear comment mutation failed: ${message}`);
    }
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    const query = `
      mutation UpdateIssueState($issueId: String!, $stateName: String!) {
        issueUpdate(id: $issueId, input: { state: { name: $stateName } }) {
          success
        }
      }
    `;
    const payload = await this.request<LinearMutationResponse>(query, { issueId, stateName });
    if (payload.errors?.length) {
      const message = payload.errors.map((error) => error.message ?? "unknown Linear error").join("; ");
      throw new Error(`Linear state mutation failed: ${message}`);
    }
  }
}

export class GitHubTrackerAdapter implements IssueTrackerAdapter {
  constructor(_config: TrackerAdapterConfig) {}

  async fetchCandidateIssues(): Promise<TrackerIssue[]> {
    throw new Error("GitHubTrackerAdapter is currently a stub and does not implement live issue polling yet.");
  }

  async fetchIssuesByStates(_states: string[]): Promise<TrackerIssue[]> {
    throw new Error("GitHubTrackerAdapter is currently a stub and does not implement live issue polling yet.");
  }

  async fetchIssueStatesByIds(_issueIds: string[]): Promise<Map<string, string>> {
    throw new Error("GitHubTrackerAdapter is currently a stub and does not implement live issue polling yet.");
  }

  async createComment(_issueId: string, _body: string): Promise<void> {
    throw new Error("GitHubTrackerAdapter is currently a stub and does not implement issue comments yet.");
  }

  async updateIssueState(_issueId: string, _stateName: string): Promise<void> {
    throw new Error("GitHubTrackerAdapter is currently a stub and does not implement issue state updates yet.");
  }
}

export function createIssueTrackerAdapter(config: TrackerAdapterConfig): IssueTrackerAdapter {
  if (config.kind === "linear") {
    return new LinearTrackerAdapter(config);
  }
  if (config.kind === "github") {
    return new GitHubTrackerAdapter(config);
  }
  throw new Error(`Unsupported tracker kind "${config.kind}".`);
}

export const createTrackerAdapter = createIssueTrackerAdapter;
