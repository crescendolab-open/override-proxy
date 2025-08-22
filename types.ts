// Shared type declarations for override-proxy
// HTTP method (standard verbs). Always UPPERCASE.
export type Method =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';
  // (Add 'TRACE' if ever needed)

// Non-empty HTTP methods list. Tuple ensures at least one.
export type MethodList = [Method, ...Method[]];

export type RuleTest = (req: import('express').Request) => boolean;
export type RuleHandler = (
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) => void | Promise<void>;
