@echo off
rem QDASH Claude Code hook wrapper for Windows
rem Forwards stdin to qdash-hook.js via node
node "C:\Users\Tyson\Desktop\Agentic dash\adapters\claude-code\qdash-hook.js" %*
exit /b 0
