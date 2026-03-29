@echo off
echo Building codex-orch-unified...
REM Use cmd instead of PowerShell to avoid stdin hang
call npm run build
if %ERRORLEVEL% EQU 0 (
    echo ✅ Build successful!
    echo Running verification...
    call node scripts/verify-build.mjs
) else (
    echo ❌ Build failed with error %ERRORLEVEL%
)
pause
