/**
 * Cloudflare Pages Function: Google Gemini API Proxy
 * 
 * This function acts as a reverse proxy, forwarding requests from /api/*
 * to Google's generativelanguage.googleapis.com endpoint.
 * 
 * Purpose: Enable domestic (China) users to access Gemini API without VPN
 * by routing traffic through Cloudflare's edge network.
 */

interface Env {
    // Add any environment variables here if needed in the future
}

// Cloudflare Pages Function context type
interface EventContext {
    request: Request;
    env: Env;
    params: Record<string, string>;
    waitUntil: (promise: Promise<unknown>) => void;
    passThroughOnException: () => void;
}

export const onRequest = async (context: EventContext): Promise<Response> => {
    const { request } = context;
    const url = new URL(request.url);

    // Rewrite the URL: /api/v1beta/... -> https://generativelanguage.googleapis.com/v1beta/...
    const targetPath = url.pathname.replace(/^\/api/, '');
    const targetUrl = `https://generativelanguage.googleapis.com${targetPath}${url.search}`;

    // Clone headers, removing host to avoid conflicts
    const headers = new Headers(request.headers);
    headers.delete('host');

    // Create the proxied request
    const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.body,
        redirect: 'follow',
    });

    try {
        // Fetch from Google API
        const response = await fetch(proxyRequest);

        // Create a new response with the same body and status
        // This ensures streaming works correctly
        const proxyResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });

        return proxyResponse;
    } catch (error) {
        // Return error response if fetch fails
        return new Response(
            JSON.stringify({ error: 'Proxy request failed', details: String(error) }),
            {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }
};
