import type { Env } from "./env";

type TurnstileResponse = {
  success?: boolean;
};

export async function verifyTurnstile(
  request: Request,
  env: Env,
  token: unknown,
): Promise<boolean> {
  if (env.TURNSTILE_REQUIRED !== "true") {
    return true;
  }

  if (
    typeof token !== "string" ||
    token.trim().length === 0 ||
    !env.TURNSTILE_SECRET_KEY
  ) {
    return false;
  }

  const formData = new FormData();
  formData.set("secret", env.TURNSTILE_SECRET_KEY);
  formData.set("response", token);

  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) {
    formData.set("remoteip", remoteIp);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: formData,
    },
  );
  const result = (await response.json()) as TurnstileResponse;

  return result.success === true;
}
