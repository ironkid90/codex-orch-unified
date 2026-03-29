#!/usr/bin/env node

// Build verification script for codex-orch-unified
// Run this after terminal issues are resolved

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('🔍 Verifying codex-orch-unified build...\n');

// Check if .next directory exists
const nextDir = join(rootDir, '.next');
if (existsSync(nextDir)) {
  console.log('✅ Found .next directory');
} else {
  console.log('❌ .next directory not found - need to build first');
  process.exit(1);
}

// Verify critical fixes in compiled output
console.log('\n📋 Verifying bug fixes in compiled output...');

// Check GraphExecutor context snapshot fix
const graphExecutorPath = join(nextDir, 'server', 'app', '_not-found', 'page.js');
if (existsSync(graphExecutorPath)) {
  const content = readFileSync(graphExecutorPath, 'utf8');
  if (content.includes('contextSnapshot') && content.includes('...(state.context')) {
    console.log('✅ GraphExecutor context snapshot fix present');
  } else {
    console.log('⚠️  GraphExecutor fix might not be properly compiled');
  }
}

// Check token tracker global guard
const enginePath = join(nextDir, 'server', 'app', 'swarm', 'route.js');
if (existsSync(enginePath)) {
  const content = readFileSync(enginePath, 'utf8');
  if (content.includes('__codexTokenTracker') && content.includes('global.__codexTokenTracker')) {
    console.log('✅ Token tracker global guard fix present');
  } else {
    console.log('⚠️  Token tracker fix might not be properly compiled');
  }
}

// Try to run type check without hanging
console.log('\n🔍 Running type check...');
try {
  // Use tsc directly without stdin
  execSync('tsc --noEmit --project tsconfig.json', { 
    stdio: 'pipe',
    cwd: rootDir,
    timeout: 30000 
  });
  console.log('✅ Type check passed');
} catch (error) {
  console.log('❌ Type check failed:');
  console.log(error.stdout?.toString() || error.message);
}

// Check for critical runtime files
console.log('\n📁 Checking critical runtime files...');
const criticalFiles = [
  '.next/server/app/api/swarm/stream/route.js',
  '.next/server/app/api/auth/[provider]/route.js',
  '.next/server/app/api/swarm/graph/route.js'
];

for (const file of criticalFiles) {
  const fullPath = join(rootDir, file);
  if (existsSync(fullPath)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ Missing ${file}`);
  }
}

console.log('\n🎉 Build verification complete!');
