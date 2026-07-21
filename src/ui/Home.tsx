// Home UI component for Keystone VS Code extension
// Provides navigation cards for Home, Active Work, Intelligence, History
// Shows repository readiness, active workflow summary, and capability matrix

import React, { useEffect, useState } from "react";
import { vscode } from "../extension/vscodeApi"; // Helper to post messages to the extension host
import RepositoryStatus from "../ui/components/RepositoryStatus";
import ActiveWorkflowSummary from "../ui/components/ActiveWorkflowSummary";
import CapabilityMatrix from "../ui/components/CapabilityMatrix";

/**
 * Home component renders the main dashboard.
 * It queries the extension host for repository readiness and active workflow data.
 */
const Home: React.FC = () => {
  const [repoReady, setRepoReady] = useState<boolean>(false);
  const [intelligenceStatus, setIntelligenceStatus] = useState<string>("unknown");
  const [activeWorkflow, setActiveWorkflow] = useState<any>(null);
  const [capabilities, setCapabilities] = useState<any[]>([]);

  // Request initial data on mount
  useEffect(() => {
    vscode.postMessage({ type: "home/init" });
    const listener = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case "home/repoStatus":
          setRepoReady(msg.ready);
          setIntelligenceStatus(msg.intelligenceStatus);
          break;
        case "home/activeWorkflow":
          setActiveWorkflow(msg.workflow);
          break;
        case "home/capabilities":
          setCapabilities(msg.capabilities);
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const navigate = (destination: string) => {
    vscode.postMessage({ type: "navigate", destination });
  };

  return (
    <div className="keystone-home">
      <h1>Keystone Home</h1>
      <section className="repo-status">
        <RepositoryStatus ready={repoReady} status={intelligenceStatus} />
      </section>
      <section className="active-workflow">
        {activeWorkflow ? (
          <ActiveWorkflowSummary workflow={activeWorkflow} />
        ) : (
          <p>No active workflow</p>
        )}
      </section>
      <section className="capability-matrix">
        <CapabilityMatrix capabilities={capabilities} />
      </section>
      <section className="navigation-cards">
        <div className="card" onClick={() => navigate("home")}>Home</div>
        <div className="card" onClick={() => navigate("activeWork")}>Active Work</div>
        <div className="card" onClick={() => navigate("intelligence")}>Intelligence</div>
        <div className="card" onClick={() => navigate("history")}>History</div>
      </section>
    </div>
  );
};

export default Home;
