import { User } from "@bench-shared";

interface UserCardProps {
  user: User;
  formattedDate: string;
}

export function UserCard({ user, formattedDate }: UserCardProps) {
  return (
    <div className="user-card">
      <h2>{user.name}</h2>
      <p>{user.email}</p>
      <small>Joined: {formattedDate}</small>
    </div>
  );
}
