import { useEffect, useState } from "react";
import type { DevelopmentWorkflowSnapshot } from "../../../shared/contracts/delegation";
import type {
  HandoffPackage,
  HandoffReconciliation,
  TaskAssignment,
  TeamAuditEntry,
  TeamParticipant,
  TeamProgressSnapshot,
} from "../../../shared/contracts/team";
import type { HostBridge } from "../../services/HostBridge";

const MEMBER_CAPABILITIES = [
  "accept-task",
  "execute-task",
  "validate-task",
  "review-task",
  "observe-workflow",
] as const;

export function TeamWorkflowWorkspace({ bridge }: { bridge: HostBridge }): React.JSX.Element {
  const [participants, setParticipants] = useState<TeamParticipant[]>([]);
  const [workflows, setWorkflows] = useState<DevelopmentWorkflowSnapshot[]>([]);
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [audit, setAudit] = useState<TeamAuditEntry[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [actorId, setActorId] = useState("");
  const [receiverId, setReceiverId] = useState("");
  const [name, setName] = useState("");
  const [packageData, setPackageData] = useState<HandoffPackage>();
  const [importId, setImportId] = useState<string>();
  const [reconciliation, setReconciliation] = useState<HandoffReconciliation>();
  const [progress, setProgress] = useState<TeamProgressSnapshot>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const workflow = workflows.find((item) => item.id === workflowId);
  const selectedTaskId = workflow?.tasks.some((item) => item.id === taskId)
    ? taskId
    : (workflow?.tasks[0]?.id ?? "");
  const task = workflow?.tasks.find((item) => item.id === selectedTaskId);
  const assignment = assignments.find(
    (item) =>
      item.taskId === selectedTaskId &&
      !["rejected", "cancelled", "completed", "transferred"].includes(item.status),
  );

  const reload = async (): Promise<void> => {
    const [members, flows, assigned, entries] = await Promise.all([
      bridge.request("team/participants", {}),
      bridge.request("workflow/list", {}),
      bridge.request("assignment/list", {}),
      bridge.request("progress/audit", { limit: 100 }),
    ]);
    setParticipants(members);
    setWorkflows(flows);
    setAssignments(assigned);
    setAudit(entries);
    const selectedWorkflow = workflowId || flows[0]?.id || "";
    setWorkflowId(selectedWorkflow);
    setActorId((current) => current || members[0]?.id || "");
    setReceiverId((current) => current || members[1]?.id || members[0]?.id || "");
    if (selectedWorkflow)
      setProgress(await bridge.request("progress/refresh", { workflowId: selectedWorkflow }));
  };
  useEffect(() => {
    let active = true;
    void Promise.all([
      bridge.request("team/participants", {}),
      bridge.request("workflow/list", {}),
      bridge.request("assignment/list", {}),
      bridge.request("progress/audit", { limit: 100 }),
    ])
      .then(async ([members, flows, assigned, entries]) => {
        if (!active) return;
        setParticipants(members);
        setWorkflows(flows);
        setAssignments(assigned);
        setAudit(entries);
        const firstWorkflowId = flows[0]?.id ?? "";
        setWorkflowId(firstWorkflowId);
        setActorId(members[0]?.id ?? "");
        setReceiverId(members[1]?.id ?? members[0]?.id ?? "");
        if (firstWorkflowId) {
          const value = await bridge.request("progress/refresh", { workflowId: firstWorkflowId });
          if (active) setProgress(value);
        }
      })
      .catch(display(setNotice));
    return () => {
      active = false;
    };
  }, [bridge]);
  const act = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      await reload();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page delivery-workspace">
      <header className="delivery-header">
        <div>
          <div className="eyebrow">Portable, explicit continuity</div>
          <h1>Team workflow</h1>
          <p>
            Participants are self-asserted local metadata. Assignments require acceptance, and
            handoffs remain reviewable artifacts until repository reconciliation and receiver
            approval.
          </p>
        </div>
        <button className="ghost-button" disabled={busy} onClick={() => void act(reload)}>
          Refresh
        </button>
      </header>
      {notice && (
        <div className="error-banner" role="status">
          {notice}
        </div>
      )}
      <div className="honesty-note">
        No authentication, cloud sync, presence, chat, automatic Git action, or automatic execution
        continuation is provided.
      </div>

      <div className="delivery-grid">
        <article className="status-card">
          <small>PARTICIPANTS · {participants.length}</small>
          <h2>Local team metadata</h2>
          <input
            value={name}
            maxLength={200}
            placeholder="Display name"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className="primary-button"
            disabled={!name.trim() || busy}
            onClick={() =>
              void act(async () => {
                const created = await bridge.request("team/addParticipant", {
                  displayName: name.trim(),
                  role: participants.length ? "developer" : "lead",
                  source: "local",
                  capabilities: participants.length
                    ? [...MEMBER_CAPABILITIES]
                    : [
                        "assign-task",
                        "accept-task",
                        "execute-task",
                        "validate-task",
                        "review-task",
                        "observe-workflow",
                        "reassign-task",
                      ],
                });
                setName("");
                setActorId(created.id);
              })
            }
          >
            Add participant
          </button>
          {participants.map((item) => (
            <p key={item.id}>
              <strong>{item.displayName}</strong>
              <br />
              <small>{item.role} · self-asserted local</small>
            </p>
          ))}
        </article>
        <article className="status-card">
          <small>WORK ITEM</small>
          <select
            aria-label="Workflow"
            value={workflowId}
            onChange={(event) => {
              setWorkflowId(event.target.value);
              setTaskId("");
              setProgress(undefined);
            }}
          >
            <option value="">Select workflow</option>
            {workflows.map((item) => (
              <option key={item.id} value={item.id}>
                {item.specification?.title ?? item.intent.normalizedObjective}
              </option>
            ))}
          </select>
          <select
            aria-label="Task"
            value={selectedTaskId}
            onChange={(event) => setTaskId(event.target.value)}
          >
            <option value="">Select task</option>
            {workflow?.tasks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.status}
              </option>
            ))}
          </select>
          <p>{task?.objective ?? "Select an approved task."}</p>
          <button
            className="ghost-button"
            disabled={!workflowId || busy}
            onClick={() =>
              void act(async () =>
                setProgress(await bridge.request("progress/refresh", { workflowId })),
              )
            }
          >
            Refresh progress
          </button>
          {progress && (
            <p>
              <strong>
                {progress.unassignedTaskIds.length} unassigned · {progress.staleTaskIds.length}{" "}
                stale
              </strong>
              <br />
              <small>
                {progress.activeBlockers.length} blockers · {progress.handoffIds.length} handoffs ·{" "}
                {progress.freshness}
              </small>
            </p>
          )}
        </article>
        <article className="status-card">
          <small>OWNERSHIP</small>
          <select
            aria-label="Assigning participant"
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
          >
            {participants.map((item) => (
              <option key={item.id} value={item.id}>
                From: {item.displayName}
              </option>
            ))}
          </select>
          <select
            aria-label="Assigned participant"
            value={receiverId}
            onChange={(event) => setReceiverId(event.target.value)}
          >
            {participants.map((item) => (
              <option key={item.id} value={item.id}>
                To: {item.displayName}
              </option>
            ))}
          </select>
          {!assignment ? (
            <button
              className="primary-button"
              disabled={!selectedTaskId || !actorId || !receiverId || busy}
              onClick={() =>
                void act(async () => {
                  await bridge.request("assignment/create", {
                    workflowId,
                    taskId: selectedTaskId,
                    assignedBy: actorId,
                    assignedTo: receiverId,
                    notes: "Assigned from Team workflow.",
                  });
                })
              }
            >
              Assign task
            </button>
          ) : (
            <>
              <h2>{assignment.status}</h2>
              <p>{participants.find((item) => item.id === assignment.assignedTo)?.displayName}</p>
              {assignment.status === "awaiting-acceptance" && (
                <div className="delivery-actions">
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await bridge.request("assignment/accept", {
                          assignmentId: assignment.id,
                          participantId: assignment.assignedTo,
                        });
                      })
                    }
                  >
                    Accept assignment
                  </button>
                  <button
                    className="ghost-button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await bridge.request("assignment/reject", {
                          assignmentId: assignment.id,
                          participantId: assignment.assignedTo,
                          reason: "Rejected in Team workflow.",
                        });
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
            </>
          )}
        </article>
      </div>

      {assignment &&
        ["accepted", "in-progress", "handoff-requested", "handoff-prepared"].includes(
          assignment.status,
        ) && (
          <section className="delivery-panel">
            <h2>Prepare handoff</h2>
            <p>
              The package contains immutable task/spec/context references and honest limitations.
              Working-tree source and executable patches are not embedded automatically.
            </p>
            <button
              className="primary-button"
              disabled={busy || assignment.status === "handoff-prepared"}
              onClick={() =>
                void act(async () => {
                  setPackageData(
                    await bridge.request("handoff/prepare", {
                      assignmentId: assignment.id,
                      senderParticipantId: assignment.assignedTo,
                      receiverParticipantId:
                        receiverId === assignment.assignedTo ? undefined : receiverId,
                      completedWork: [],
                      remainingWork: [task?.objective ?? "Continue the assigned task."],
                      blockers: [],
                      openQuestions: [],
                      senderNotes: "Review repository compatibility before continuing.",
                    }),
                  );
                })
              }
            >
              Build immutable package
            </button>
          </section>
        )}

      {packageData && (
        <section className="delivery-panel">
          <div className="delivery-panel-heading">
            <div>
              <small>HANDOFF PACKAGE</small>
              <h2>{packageData.task.title}</h2>
            </div>
            <span>{packageData.fingerprint.slice(0, 20)}…</span>
          </div>
          <p>
            {packageData.repository.branch ?? "unknown branch"} @{" "}
            {packageData.repository.headCommit?.slice(0, 12) ?? "unknown HEAD"}
          </p>
          <div className="delivery-actions">
            <button
              className="ghost-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await bridge.request("handoff/export", {
                    packageId: packageData.id,
                    mode: "json",
                  });
                })
              }
            >
              Export JSON…
            </button>
            <button
              className="ghost-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await bridge.request("handoff/export", {
                    packageId: packageData.id,
                    mode: "zip",
                  });
                })
              }
            >
              Export ZIP…
            </button>
            <button
              className="ghost-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await bridge.request("handoff/export", {
                    packageId: packageData.id,
                    mode: "clipboard-summary",
                  });
                  setNotice("Reduced-fidelity summary copied.");
                })
              }
            >
              Copy summary
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  setReconciliation(
                    await bridge.request("handoff/reconcile", { packageId: packageData.id }),
                  );
                })
              }
            >
              Reconcile repository
            </button>
          </div>
        </section>
      )}

      <section className="delivery-panel">
        <h2>Import for review</h2>
        <p>
          JSON and deterministic STORE ZIP artifacts are schema-, size-, secret-, path-, and
          fingerprint-validated before they become reviewable.
        </p>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const imported = await bridge.request("handoff/import", { source: "file" });
              if (imported) {
                setPackageData(imported.package);
                setImportId(imported.importId);
                setReconciliation(undefined);
              }
            })
          }
        >
          Choose handoff artifact…
        </button>
      </section>

      {reconciliation && packageData && (
        <section className="delivery-panel">
          <h2>Receiver decision · {reconciliation.compatibility}</h2>
          {reconciliation.differences.map((item) => (
            <p className="delivery-warning" key={item}>
              {item}
            </p>
          ))}
          <p>
            {reconciliation.safeToAccept
              ? "Active acceptance is safe after review."
              : "Active acceptance is blocked; read-only review remains available."}
          </p>
          <select
            aria-label="Receiving participant"
            value={receiverId}
            onChange={(event) => setReceiverId(event.target.value)}
          >
            {participants.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
          <div className="delivery-actions">
            <button
              className="primary-button"
              disabled={!reconciliation.safeToAccept || !receiverId || busy}
              onClick={() =>
                void act(async () => {
                  await bridge.request("handoff/accept", {
                    packageId: packageData.id,
                    importId,
                    receiverParticipantId: receiverId,
                    reconciliationId: reconciliation.id,
                    decision: "accepted",
                  });
                  setNotice(
                    "Handoff accepted. Start a new execution session and approve it explicitly before work continues.",
                  );
                })
              }
            >
              Accept handoff
            </button>
            <button
              className="ghost-button"
              disabled={!receiverId || busy}
              onClick={() =>
                void act(async () => {
                  await bridge.request("handoff/importReadOnly", {
                    packageId: packageData.id,
                    importId,
                    receiverParticipantId: receiverId,
                    reconciliationId: reconciliation.id,
                    decision: "read-only",
                    reason: "Retained for read-only review.",
                  });
                })
              }
            >
              Keep read-only
            </button>
          </div>
        </section>
      )}

      <section className="delivery-panel">
        <h2>Audit trail</h2>
        {audit.slice(0, 20).map((item) => (
          <p key={item.id}>
            <strong>{item.action}</strong> · {item.createdAt}
            <br />
            <small>{item.reason ?? item.relatedId}</small>
          </p>
        ))}
        {!audit.length && <p>No team workflow actions recorded.</p>}
      </section>
    </section>
  );
}

function display(setter: (message: string) => void): (cause: unknown) => void {
  return (cause) => setter(cause instanceof Error ? cause.message : String(cause));
}
