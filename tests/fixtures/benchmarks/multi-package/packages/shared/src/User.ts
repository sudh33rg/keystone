import { validateEmail } from "@bench-utils";

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export function createUser(email: string, name: string): User {
  if (!validateEmail(email)) {
    throw new Error(`Invalid email: ${email}`);
  }
  return {
    id: crypto.randomUUID(),
    email,
    name,
    createdAt: new Date(),
  };
}
