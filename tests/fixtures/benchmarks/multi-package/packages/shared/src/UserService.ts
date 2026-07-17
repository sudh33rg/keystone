import { User, createUser } from "./User";

export function now(): number {
  return Date.now();
}

export class UserService {
  private users: User[] = [];

  register(email: string, name: string): User {
    const user = createUser(email, name);
    this.users.push(user);
    return user;
  }

  findById(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  findByEmail(email: string): User | undefined {
    return this.users.find((u) => u.email === email);
  }

  all(): User[] {
    return [...this.users];
  }
}
