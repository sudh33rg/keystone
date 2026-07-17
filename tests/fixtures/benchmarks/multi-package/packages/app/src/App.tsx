import { UserService } from "@bench-shared";
import { formatDate } from "@bench-utils";
import { UserCard } from "./components/UserCard";

export function App() {
  const service = new UserService();
  const user = service.register("alice@example.com", "Alice");
  const formatted = formatDate(user.createdAt);

  return (
    <div className="app">
      <h1>Users</h1>
      <UserCard user={user} formattedDate={formatted} />
    </div>
  );
}
