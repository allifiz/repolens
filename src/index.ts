#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { renderHtml } from './render.js';
import { scanProject } from './scanner.js';

const program = new Command();
const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), '..');

program
  .name('repolens')
  .description('Understand a TypeScript/NestJS codebase in seconds.')
  .version('0.3.2');

program
  .command('scan')
  .argument('[directory]', 'project directory', '.')
  .option('-o, --output <directory>', 'custom output directory')
  .description('scan a codebase and generate a dependency graph + local viewer')
  .action(async (directory: string, options: { output?: string }) => {
    const root = path.resolve(directory);
    const projectName = path.basename(root);
    const outputDir = options.output
      ? path.resolve(options.output)
      : path.join(projectRoot, 'service', projectName);

    console.log(`RepoLens scanning ${root}`);
    const result = await scanProject(root);

    await fs.mkdir(outputDir, { recursive: true });

    const jsonPath = path.join(outputDir, 'graph.json');
    const htmlPath = path.join(outputDir, 'index.html');

    await Promise.all([
      fs.writeFile(jsonPath, JSON.stringify(result, null, 2)),
      fs.writeFile(htmlPath, renderHtml(result)),
    ]);

    console.log('');
    console.log(`✓ ${result.filesScanned} TypeScript files scanned`);
    console.log(`✓ ${result.nodes.length} graph nodes`);
    console.log(`✓ ${result.edges.length} relationships`);
    console.log(`✓ ${result.endpoints.length} NestJS endpoints`);
    console.log('');
    console.log(`Graph:  ${jsonPath}`);
    console.log(`Viewer: ${htmlPath}`);
    console.log('');
    console.log('Open index.html in your browser to explore the repository.');
  });

function printTrace(result: Awaited<ReturnType<typeof scanProject>>, endpoint: Awaited<ReturnType<typeof scanProject>>['endpoints'][number]): void {
  console.log(`${endpoint.method} ${endpoint.path}`);
  console.log(`Controller: ${endpoint.controller}.${endpoint.handler} (${endpoint.file}:${endpoint.line})`);

  if (endpoint.request.length) {
    console.log('');
    console.log('Request');
    for (const item of endpoint.request) {
      console.log(`  - ${item.source}${item.name ? ':' + item.name : ''}${item.type ? ' -> ' + item.type : ''}`);
    }
  }

  if (endpoint.guards.length) {
    console.log('');
    console.log('Guards');
    endpoint.guards.forEach((item) => console.log(`  - ${item}`));
  }

  if (endpoint.interceptors.length) {
    console.log('');
    console.log('Interceptors');
    endpoint.interceptors.forEach((item) => console.log(`  - ${item}`));
  }

  if (endpoint.responseType) {
    console.log('');
    console.log(`Response: ${endpoint.responseType}`);
  }

  if (endpoint.callChain.length) {
    console.log('');
    console.log('Calls');
    endpoint.callChain.forEach((step) => {
      console.log(`  -> ${step.className}.${step.method} (${step.file}:${step.line})`);
    });
  }

  if (endpoint.database.length) {
    console.log('');
    console.log('Database');
    endpoint.database.forEach((db) => {
      console.log(`  -> [${db.kind}] ${db.target} (${db.file}:${db.line})`);
    });
  }

  if (endpoint.externalCalls.length) {
    console.log('');
    console.log('External');
    endpoint.externalCalls.forEach((call) => {
      console.log(`  -> ${call.method} ${call.target} (${call.file}:${call.line})`);
    });
  }

  console.log('');
  console.log(`Project: ${result.project}`);
}

program
  .command('trace')
  .argument('<endpoint>', 'endpoint selector, for example "GET /api/v1/bab/all"')
  .argument('[directory]', 'project directory', '.')
  .description('trace one endpoint through controller, calls, database, and external services')
  .action(async (selector: string, directory: string) => {
    const result = await scanProject(path.resolve(directory));
    const normalized = selector.trim().replace(/\s+/g, ' ');
    const exact = result.endpoints.find(
      (endpoint) => `${endpoint.method} ${endpoint.path}` === normalized,
    );

    const partial = exact ?? result.endpoints.find(
      (endpoint) =>
        endpoint.path === normalized ||
        endpoint.path.includes(normalized) ||
        `${endpoint.method} ${endpoint.path}`.includes(normalized),
    );

    if (!partial) {
      console.error(`Endpoint not found: ${selector}`);
      process.exitCode = 1;
      return;
    }

    printTrace(result, partial);
  });

program
  .command('json')
  .argument('[directory]', 'project directory', '.')
  .description('print scan result as JSON')
  .action(async (directory: string) => {
    const result = await scanProject(path.resolve(directory));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
