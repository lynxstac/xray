import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ParsedFile, ScanResult } from '@xray/core';
import { scanRepository, type ScanOptions } from '@xray/scanner';
import { parseSource } from '@xray/parser';
import { assemble, buildNodes, nodesByFile } from './assemble.ts';
import { computeSemantic } from './semantic.ts';
import { detectNextRoots, detectWorkspacePackages } from './routes.ts';
import type { CodeGraph } from './model.ts';

export interface BuiltIndex {
  root: string;
  scan: ScanResult;
  files: ParsedFile[];
  failed: { path: string; error: string }[];
  graph: CodeGraph;
  ms: number;
}

/** Soddalashtirilgan (incremental'siz) to'liq qurish. Incremental — engine.ts. */
export async function buildGraphFromDisk(rootInput: string, opts: ScanOptions = {}): Promise<BuiltIndex> {
  const t0 = performance.now();
  const scan = await scanRepository(rootInput, opts);
  const files: ParsedFile[] = [];
  const failed: BuiltIndex['failed'] = [];
  for (const f of scan.files) {
    try {
      files.push(parseSource(f.path, await fs.readFile(path.join(scan.root, f.path), 'utf8')));
    } catch (e) {
      failed.push({ path: f.path, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const nodes = buildNodes(files, await detectNextRoots(scan.root, files.map((f) => f.path)));
  const semantic = computeSemantic({ root: scan.root, files, nodesByFile: nodesByFile(nodes), workspacePackages: await detectWorkspacePackages(scan.root, files.map((f) => f.path)) });
  return { root: scan.root, scan, files, failed, graph: assemble(nodes, semantic), ms: Math.round(performance.now() - t0) };
}
