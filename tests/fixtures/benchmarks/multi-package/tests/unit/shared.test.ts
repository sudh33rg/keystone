import { UserService, createUser } from "@bench-shared";
import { validateEmail } from "@bench-utils";

describe("shared", () => {
  describe("createUser", () => {
    it("creates a user with valid email", () => {
      const user = createUser("test@example.com", "Test User");
      expect(user.email).toBe("test@example.com");
      expect(user.name).toBe("Test User");
      expect(user.id).toBeDefined();
    });

    it("throws on invalid email", () => {
      expect(() => createUser("not-an-email", "Test")).toThrow();
    });
  });

  describe("UserService", () => {
    it("registers and finds users", () => {
      const svc = new UserService();
      const user = svc.register("a@b.com", "A");
      expect(svc.findById(user.id)).toBe(user);
    });
  });
});
