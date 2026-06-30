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
      Accept: "application/json",
      "Content-Type": request.headers.get("Content-Type") ?? "application/json",
      password: apiPassword,
      ...(request.headers.get("Authorization") ? { Authorization: request.headers.get("Authorization")! } : {}),
    },
    body: hasBody ? await request.text() : undefined,
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
