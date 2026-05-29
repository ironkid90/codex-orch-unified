import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

const OPERATOR_TOKEN_ENV = "DASHBOARD_OPERATOR_TOKEN";
const OPERATOR_TOKEN_HEADER = "x-dashboard-operator-token";

function stripPort(host: string): string {
  const normalized = host.trim().replace(/^\[|\]$/g, "");
  const lastColon = normalized.lastIndexOf(":");
  if (lastColon <= 0 || normalized.includes("::")) {
    return normalized;
  }
  return normalized.slice(0, lastColon);
}

function resolveRequestHostname(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    return stripPort(forwardedHost.split(",")[0] || "");
  }

  const host = request.headers.get("host");
  if (host) {
    return stripPort(host);
  }

  return new URL(request.url).hostname;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function readPresentedToken(request: Request): string | null {
  const headerToken = request.headers.get(OPERATOR_TOKEN_HEADER)?.trim();
  if (headerToken) {
    return headerToken;
  }

  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) {
    return null;
  }

  const [scheme, value] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !value?.trim()) {
    return null;
  }

  return value.trim();
}

function tokensMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function requireDashboardMutationAuth(request: Request): NextResponse | null {
  const hostname = resolveRequestHostname(request);
  if (isLoopbackHost(hostname)) {
    return null;
  }

  const expectedToken = process.env[OPERATOR_TOKEN_ENV]?.trim();
  if (!expectedToken) {
    return NextResponse.json(
      {
        error: `Non-loopback dashboard mutations require ${OPERATOR_TOKEN_ENV} to be configured.`,
      },
      { status: 503 },
    );
  }

  const presentedToken = readPresentedToken(request);
  if (!presentedToken) {
    return NextResponse.json(
      {
        error: "Provide a bearer token or x-dashboard-operator-token for non-loopback dashboard mutations.",
      },
      {
        status: 401,
        headers: {
          "www-authenticate": "Bearer",
        },
      },
    );
  }

  if (!tokensMatch(expectedToken, presentedToken)) {
    return NextResponse.json({ error: "Invalid dashboard operator token." }, { status: 403 });
  }

  return null;
}
