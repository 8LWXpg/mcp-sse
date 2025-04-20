import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const server = new McpServer({
	name: 'openkm',
	version: '1.0.0',
});

const okmHeaders = new Headers();
okmHeaders.set('Authorization', 'Basic ' + btoa(`okmAdmin:admin`));
okmHeaders.set('Accept', 'application/json');

const okmURL = 'http://192.168.0.42:8080/OpenKM/services/rest';

server.resource(
	'Get user last modified documents',
	'dashboard://getUserLastModifiedDocuments',
	async (uri: URL) => ({
		contents: [
			{
				uri: uri.href,
				text: await (
					await fetch(`${okmURL}/dashboard/getUserLastModifiedDocuments`, {
						headers: okmHeaders,
					})
				).text(),
			},
		],
	}),
);

server.resource(
	'Get user last uploaded documents',
	'dashboard://getUserLastUploadedDocuments',
	async (uri: URL) => ({
		contents: [
			{
				uri: uri.href,
				text: await (
					await fetch(`${okmURL}/dashboard/getUserLastUploadedDocuments`, {
						headers: okmHeaders,
					})
				).text(),
			},
		],
	}),
);

server.resource(
	'Get list of all keywords',
	'search://getKeywordMap',
	async (uri: URL) => ({
		contents: [
			{
				uri: uri.href,
				text: await (
					await fetch(`${okmURL}/search/getKeywordMap`, { headers: okmHeaders })
				).text(),
			},
		],
	}),
);

async function downloadFile(url: URL, fileName: string): Promise<string> {
	try {
		const okmHeaders = new Headers();
		okmHeaders.set('Authorization', 'Basic ' + btoa(`okmAdmin:admin`));
		const res = await fetch(url, { headers: okmHeaders });
		if (!res.ok) {
			throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
		}
		const fileBuffer = await res.arrayBuffer();

		const tempDir = tmpdir();
		const filePath = path.join(tempDir, fileName);
		fs.writeFileSync(filePath, Buffer.from(fileBuffer));

		console.log(`File downloaded to: ${filePath}`);
		return filePath;
	} catch (e) {
		console.error('Error downloading file:', e);
		throw e;
	}
}

function docToMarkdown(filePath: string): string {
	const pandoc = spawnSync('pandoc', [filePath, '-t', 'gfm', '-o', '-']);
	return pandoc.stdout.toString('utf8');
}

server.tool('document-get-content', { uuid: z.string() }, async ({ uuid }) => {
	// Get document name
	const filePath = await (
		await fetch(`${okmURL}/document/getPath/${uuid}`, {
			headers: okmHeaders,
		})
	).text();
	const fileName = filePath.split('/').pop() || filePath;

	const download = await downloadFile(
		new URL(`${okmURL}/document/getContent?docId=${uuid}`),
		fileName,
	);
	const md = docToMarkdown(download);
	return {
		content: [
			{
				type: 'text',
				text: md,
			},
		],
	};
});

const SearchQurey = z.object({
	offset: z.number().int().nullish(),
	limit: z.number().int().nullish(),
	content: z.string().nullish(),
	name: z.string().nullish(),
	domain: z.number().int().nullish(),
	keyword: z.string().array().nullish(),
	category: z.string().array().nullish(),
	property: z.string().array().nullish(),
	author: z.string().nullish(),
	mimeType: z.string().nullish(),
	lastModifiedFrom: z.string().nullish(),
	lastModifiedTo: z.string().nullish(),
	mailSubject: z.string().nullish(),
	mailFrom: z.string().nullish(),
	mailTo: z.string().nullish(),
	path: z.string().nullish(),
});

server.tool(
	'find-paginated',
	{ searchQuery: SearchQurey },
	async ({ searchQuery }) => {
		const url = new URL(`${okmURL}/search/findPaginated`);
		Object.entries(searchQuery).forEach(([k, v]) => {
			url.searchParams.append(k, String(v));
		});
		return {
			content: [
				{
					type: 'text',
					text: await (
						await fetch(url, {
							headers: okmHeaders,
						})
					).text(),
				},
			],
		};
	},
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
