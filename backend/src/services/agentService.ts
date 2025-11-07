import { ApiError } from '../errors';
import { AgentServiceResponse } from '../types/models';

export interface AgentServiceRequest {
    sessionId: string;
    userId: string;
    message: string;
    context: Record<string, unknown>;
    state: Record<string, unknown>;
}

function getAgentServiceUrl(): string {
    const url = process.env.AGENT_SERVICE_URL;
    if (!url) {
        throw new ApiError(500, 'Agent service URL not configured.');
    }
    return url.replace(/\/$/, '');
}

export async function invokeAgentService(payload: AgentServiceRequest): Promise<AgentServiceResponse> {
    const url = `${getAgentServiceUrl()}/agent/run`;
    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (process.env.AGENT_SERVICE_AUTH_TOKEN) {
            headers.Authorization = `Bearer ${process.env.AGENT_SERVICE_AUTH_TOKEN}`;
        }
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const message = await response.text();
            if (response.status === 503) {
                throw new ApiError(503, 'Agent service unavailable. Please try again later.');
            }
            throw new ApiError(response.status, message || 'Agent service error.');
        }
        const data = (await response.json()) as AgentServiceResponse;
        return data;
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }
        throw new ApiError(503, 'Agent service unavailable. Please try again later.');
    }
}
