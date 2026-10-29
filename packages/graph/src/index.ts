export { CodeGraph, locContains } from './model.ts';
export { buildNodes, nodesByFile, assemble } from './assemble.ts';
export { computeSemantic, type FileSemantic, type SemanticInput } from './semantic.ts';
export { buildGraphFromDisk, type BuiltIndex } from './build.ts';
export { indexProject, openStore, type IndexOptions, type IndexResult, type IndexMode } from './engine.ts';
export { detectWorkspacePackages, type WorkspacePackage } from './routes.ts';
export { detectNextRoots, nearestNextRoot, routeForFile, isLeafRoute, isScopeRoute } from './routes.ts';
export { XrayStore, splitIdent, type FtsHit, type FtsRow, type StoredFile } from './store.ts';
