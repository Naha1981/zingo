type User = { userId: string; email: string };
async function request(method: string, path: string, body?: unknown) {
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) {
    const e: any = new Error(data.error || "Request failed");
    e.response = { data, status: r.status };
    throw e;
  }
  return { data };
}
export const api = {
  get: (p: string) => request("GET", p),
  post: (p: string, b: unknown) => request("POST", p, b),
  put: (p: string, b: unknown) => request("PUT", p, b),
};
export const auth = {
  getUser: async (): Promise<User | null> =>
    (await api.get("/api/auth/me")).data.user,
  signOut: () => api.post("/api/auth/logout", {}),
  login: async (
    email: string,
    password: string,
    create: boolean,
  ): Promise<User> =>
    (
      await api.post(create ? "/api/auth/register" : "/api/auth/login", {
        email,
        password,
      })
    ).data.user,
};
