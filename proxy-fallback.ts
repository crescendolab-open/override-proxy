import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { Socket } from "node:net";
import { logError } from "./logger.js";

export interface CreateProxyFallbackOptions {
  target: string;
  nextRequestId: () => number;
  markProxyResponse?: (res: Response) => void;
  resolveLogId?: (res: Response) => number;
  rewritePath?: (path: string) => string;
}

export function createProxyFallback({
  target,
  nextRequestId,
  markProxyResponse,
  resolveLogId,
  rewritePath,
}: CreateProxyFallbackOptions): RequestHandler {
  return createProxyMiddleware<Request, Response, NextFunction>({
    target,
    changeOrigin: true,
    ...(rewritePath ? { pathRewrite: rewritePath } : {}),
    on: {
      proxyReq: (_proxyReq, req) => {
        if (req.res) markProxyResponse?.(req.res);
      },
      error: (err, _req, res) => {
        if (!isExpressResponse(res)) {
          logError(nextRequestId(), err);
          res.destroy();
          return;
        }
        logError(resolveLogId?.(res) ?? nextRequestId(), err);
        if (res.headersSent) {
          res.end();
          return;
        }
        res.status(502).json({ error: "proxy_error", detail: String(err) });
      },
    },
  });
}

function isExpressResponse(res: Response | Socket): res is Response {
  return "status" in res && "headersSent" in res;
}
