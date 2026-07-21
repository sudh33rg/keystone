// RepositoryStatus component displays repository readiness and intelligence status

import React from "react";

interface RepositoryStatusProps {
  ready: boolean;
  status: string;
}

/**
 * Shows whether the repository intelligence is ready and the current ingestion status.
 */
const RepositoryStatus: React.FC<RepositoryStatusProps> = ({ ready, status }) => {
  const readiness = ready ? "Ready" : "Not Ready";
  return (
    <div className="repository-status">
      <h2>Repository Status</h2>
      <p>Intelligence: {status}</p>
      <p>Readiness: {readiness}</p>
    </div>
  );
};

export default RepositoryStatus;
