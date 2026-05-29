import { httpRouter } from "convex/server";

import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const requestUrl = new URL(request.url);
    const target = new URL("/", process.env.SITE_URL ?? "https://cc-sync.dev");
    const error = requestUrl.searchParams.get("error");
    const errorDescription = requestUrl.searchParams.get("error_description");
    if (error) target.searchParams.set("error", error);
    if (errorDescription) target.searchParams.set("error_description", errorDescription);
    return Response.redirect(target.toString(), 302);
  }),
});

authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
