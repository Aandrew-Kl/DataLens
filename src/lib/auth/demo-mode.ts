export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

export interface DemoUser {
  id: string;
  email: string;
  name: string;
  isDemoUser: true;
}

export function getDemoUser(): DemoUser {
  return {
    id: "demo-user",
    email: "demo@datalens.local",
    name: "Demo User",
    isDemoUser: true,
  };
}
