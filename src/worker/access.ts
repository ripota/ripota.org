export type AccessIdentity = {
  email: string;
};

export function requireAccessIdentity(
  request: Request,
): AccessIdentity | Response {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");

  if (!email) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  return { email };
}
