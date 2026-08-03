export declare const dbQueries: {
    getAllLeads(): Promise<any[]>;
    insertLead(leadData: Record<string, any>): Promise<any>;
    clearAllLeads(): Promise<{
        success: boolean;
    }>;
    getAllCompanies(): Promise<any[]>;
    getAgentStatus(agentId: string): Promise<any>;
    updateAgentStatus(agentId: string, updates: Record<string, any>): Promise<any>;
    logAgentTelemetry(agentId: string, level: "info" | "warn" | "error", message: string): Promise<void>;
    getAllDeals(): Promise<any[]>;
    updateDealStage(dealId: string, stage: string): Promise<any>;
    createPipelineRun(runData: Record<string, any>): Promise<any>;
    updatePipelineRun(runId: string, updates: Record<string, any>): Promise<any>;
    getPipelineRuns(limit?: number): Promise<any[]>;
    getPipelineRunById(runId: string): Promise<any>;
    logAgentExecution(execData: Record<string, any>): Promise<any>;
    getAgentExecutions(pipelineRunId: string): Promise<any[]>;
    getAllAgentStatuses(): Promise<any[]>;
};
