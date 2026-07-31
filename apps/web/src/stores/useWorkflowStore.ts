import { create } from "zustand";
import { Workflow } from "@/types";
import { mockWorkflows } from "@/lib/mockData";

interface WorkflowState {
  workflows: Workflow[];
  activeWorkflow: Workflow | null;
  setActiveWorkflow: (workflow: Workflow | null) => void;
  toggleWorkflowStatus: (id: string) => void;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  workflows: mockWorkflows,
  activeWorkflow: mockWorkflows[0] || null,
  setActiveWorkflow: (workflow) => set({ activeWorkflow: workflow }),
  toggleWorkflowStatus: (id) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === id ? { ...w, status: w.status === "active" ? "paused" : "active" } : w
      ),
    })),
}));
