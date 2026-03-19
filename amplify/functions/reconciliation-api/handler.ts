import type { APIGatewayProxyHandler } from 'aws-lambda';

/**
 * Main Lambda handler for the reconciliation API.
 * Routes requests to appropriate service handlers.
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const { httpMethod, path } = event;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle CORS preflight
  if (httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Health check
    if (path === '/api/health' && httpMethod === 'GET') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }),
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found', path, method: httpMethod }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: message }),
    };
  }
};
