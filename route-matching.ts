import type { NormalizedRoute, RoutePath } from "./config.js";

export interface RankedRoute {
  route: NormalizedRoute;
  declarationIndex: number;
}

export function sortRoutes(routes: NormalizedRoute[]): RankedRoute[] {
  return routes
    .map((route, declarationIndex) => ({ route, declarationIndex }))
    .sort((a, b) => {
      if (a.route.priority !== b.route.priority) {
        return b.route.priority - a.route.priority;
      }
      if (a.route.path === "/" && b.route.path !== "/") return 1;
      if (b.route.path === "/" && a.route.path !== "/") return -1;
      if (a.route.path.length !== b.route.path.length) {
        return b.route.path.length - a.route.path.length;
      }
      return a.declarationIndex - b.declarationIndex;
    });
}

export function matchesRoutePath(routePath: RoutePath, pathname: string): boolean {
  if (routePath === "/") return true;
  if (routePath.endsWith("/")) return pathname.startsWith(routePath);
  return pathname === routePath || pathname.startsWith(`${routePath}/`);
}

export function findRoute<T extends { route: NormalizedRoute }>(
  routes: readonly T[],
  pathname: string,
): T | null {
  return routes.find((entry) => matchesRoutePath(entry.route.path, pathname)) ?? null;
}

export function rewriteRoutePath(route: NormalizedRoute, pathname: string): string {
  const rewrite = route.rewrite;
  if (!rewrite) return pathname;
  if (rewrite.path) return rewrite.path({ pathname, route });

  let nextPath = pathname;
  if (rewrite.stripPrefix) {
    nextPath = stripRoutePrefix(route.path, nextPath);
  }
  if (rewrite.prefix) {
    nextPath = joinUrlPaths(rewrite.prefix, nextPath);
  }

  return nextPath;
}

function stripRoutePrefix(routePath: RoutePath, pathname: string): string {
  if (routePath === "/") return pathname;

  const stripped = pathname.slice(routePath.length);
  if (!stripped) return "/";
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

function joinUrlPaths(prefix: RoutePath, pathname: string): string {
  const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${normalizedPrefix}${normalizedPath}` || "/";
}
