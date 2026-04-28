export type Method =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type MethodList = [Method, ...Method[]];

export type RuleTest = (req: import("express").Request) => boolean;
export type RuleHandler = (
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) => void | Promise<void>;
