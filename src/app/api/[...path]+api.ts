async function forward(request: Request) {
  const apiBaseUrl = process.env.EXPO_PUBLIC_LFA_API_BASE_URL?.replace(/\/$/, "") ?? "https://api-lfa.matrixvert.com/api";
  const apiPassword = process.env.EXPO_PUBLIC_LFA_API_PASSWORD ?? process.env.API_PASSWORD;

  if (!apiPassword) {
    return Response.json(
      { message: "LFA API password is missing in the Expo server environment. Restart Expo after setting EXPO_PUBLIC_LFA_API_PASSWORD." },
      { status: 500 },
    );
  }

  const incomingUrl = new URL(request.url);
  const upstreamPath = incomingUrl.pathname.replace(/^\/api/, "") || "/";
  const upstreamUrl = `${apiBaseUrl}${upstreamPath}${incomingUrl.search}`;
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const upstream = await fetch(upstreamUrl, {
    method,
    headers: {
      Accept: request.headers.get("Accept") ?? "application/json",
      ...(hasBody ? { "Content-Type": request.headers.get("Content-Type") ?? "application/json" } : {}),
      password: apiPassword,
      ...(request.headers.get("Authorization") ? { Authorization: request.headers.get("Authorization")! } : {}),
    },
    body: hasBody ? await request.text() : undefined,
  });

  const contentType = upstream.headers.get("Content-Type") ?? "application/json";
  const body = contentType.includes("application/pdf") || contentType.includes("application/octet-stream")
    ? upstream.body
    : await upstream.text();
  const headers = new Headers({
    "Content-Type": contentType,
  });
  const disposition = upstream.headers.get("Content-Disposition");
  if (disposition) headers.set("Content-Disposition", disposition);

  return new Response(body, {
    status: upstream.status,
    headers,
  });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
