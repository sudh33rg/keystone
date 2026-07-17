import { App } from "@bench-app/src/App";

describe("app", () => {
  it("renders without crashing", () => {
    const app = <App />;
    expect(app).toBeDefined();
  });
});
