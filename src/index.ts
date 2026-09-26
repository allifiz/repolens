#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { renderHtml } from './render.js';
import { scanProject } from './scanner.js';

const program = new Command();

program
  .name('repolens')
  .description('Understand a TypeScript/NestJS codebase in seconds.')
  .version('0.1.0');

program
  .command('scan')
  .argument('[directory]', 'project directory', '.')
  .option('-o, --output <directory>', 'output directory', '.repolens')
  .description('scan a codebase and generate a dependency graph + local viewer')
  .action(async (directory: string, options: { output: string }) => {
    const root = path.resolve(directory);
    const outputDir = path.resolve(root, options.output);

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
