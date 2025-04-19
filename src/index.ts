import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const server = new McpServer({
	name: 'openkm',
	version: '1.0.0',
});

const okmHeaders = new Headers();
okmHeaders.set('Authorization', 'Basic ' + btoa(`okmAdmin:admin`));
okmHeaders.set('Accept', 'application/json');

const okmURL = 'http://192.168.0.42:8080/OpenKM/services/rest';

server.tool('echo', { message: z.string() }, async ({ message }) => ({
	content: [{ type: 'text', text: `Tool echo: ${message} ${message}` }],
}));

server.resource(
	'Get user last modified documents',
	'dashboard://getUserLastModifiedDocuments',
	async (uri: URL) => ({
		contents: [
			{
				uri: uri.href,
				text: JSON.stringify(
					await (
						await fetch(`${okmURL}/dashboard/getUserLastModifiedDocuments`, {
							headers: okmHeaders,
						})
					).json(),
				),
			},
		],
	}),
);

const app = express();

// to support multiple simultaneous connections we have a lookup object from
// sessionId to transport
const transports: { [sessionId: string]: SSEServerTransport } = {};

app.get('/sse', async (_: Request, res: Response) => {
	const transport = new SSEServerTransport('/messages', res);
	transports[transport.sessionId] = transport;
	res.on('close', () => {
		delete transports[transport.sessionId];
	});
	await server.connect(transport);
});

app.post('/messages', async (req: Request, res: Response) => {
	const sessionId = req.query.sessionId as string;
	const transport = transports[sessionId];
	if (transport) {
		await transport.handlePostMessage(req, res);
	} else {
		res.status(400).send('No transport found for sessionId');
	}
});

app.listen(3001);
