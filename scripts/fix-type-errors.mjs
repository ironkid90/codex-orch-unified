import fs from 'fs';
import path from 'path';

const basePath = path.join(process.cwd(), 'lib', 'swarm');

// Fix graph-executor.ts
const gePath = path.join(basePath, 'graph-executor.ts');
let geContent = fs.readFileSync(gePath, 'utf8');
geContent = geContent.replace(
  'return { nodeId, status: "completed" as const, round };',
  'return { nodeId, status: "completed" as const, round, output: undefined };'
);
fs.writeFileSync(gePath, geContent, 'utf8');
console.log('Fixed graph-executor.ts');

// Fix engine.ts
const enginePath = path.join(basePath, 'engine.ts');
let engineContent = fs.readFileSync(enginePath, 'utf8');

// Replace { nodeId: node.id, status: "completed", output: XYZ } with { nodeId: node.id, status: "completed", retryCount: 0, output: XYZ }
engineContent = engineContent.replace(/return {\s*nodeId:\s*node\.id,\s*status:\s*"completed",\s*output:\s*(.*?)\s*};/g, 'return { nodeId: node.id, status: "completed", retryCount: 0, output: $1 };');

// Also replace the empty one at the end of executeNode
engineContent = engineContent.replace(/return {\s*nodeId:\s*node\.id,\s*status:\s*"completed"\s*};/g, 'return { nodeId: node.id, status: "completed", retryCount: 0 };');

// Fix origExecuteNode and origOnRoundEnd possible undefined
engineContent = engineContent.replace(/const origExecuteNode = executor\["config"\]\.executeNode;/g, 'const origExecuteNode = executor["config"]?.executeNode!;');
engineContent = engineContent.replace(/const origOnRoundEnd = executor\["config"\]\.onRoundEnd;/g, 'const origOnRoundEnd = executor["config"]?.onRoundEnd!;');

fs.writeFileSync(enginePath, engineContent, 'utf8');
console.log('Fixed engine.ts');

// Fix scripts/swarm-models.ts
const modelsPath = path.join(process.cwd(), 'scripts', 'swarm-models.ts');
let modelsContent = fs.readFileSync(modelsPath, 'utf8');
if (!modelsContent.includes('planner: { coding:')) {
  modelsContent = modelsContent.replace(
    'research: { coding: 0.08, reasoning: 0.32, context: 0.35, speed: 0.15, cost: 0.1 },',
    'planner: { coding: 0.1, reasoning: 0.4, context: 0.3, speed: 0.1, cost: 0.1 },\n  research: { coding: 0.08, reasoning: 0.32, context: 0.35, speed: 0.15, cost: 0.1 },'
  );
}
if (!modelsContent.includes('planner: { gemini:')) {
  modelsContent = modelsContent.replace(
    'research: { gemini: 8, openai: 6, codex: 2 },',
    'planner: { gemini: 8, openai: 9, codex: 4 },\n  research: { gemini: 8, openai: 6, codex: 2 },'
  );
}
fs.writeFileSync(modelsPath, modelsContent, 'utf8');
console.log('Fixed swarm-models.ts');
